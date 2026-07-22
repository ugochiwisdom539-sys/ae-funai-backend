// webauthn.js
//
// Real fingerprint/biometric verification using WebAuthn — the same browser
// standard behind Face ID, Touch ID, Windows Hello, and Android fingerprint
// unlock. No external hardware needed; this uses whatever biometric sensor
// is already built into the student's own phone or laptop.
//
// Uses the @simplewebauthn/server library to handle the cryptographic
// challenge/response work correctly and securely.

const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const { db } = require('./db');

// ---------------------------------------------------------------------------
// Relying Party (RP) config — identifies YOUR site to the browser's WebAuthn
// API. rpID must be the bare domain (no https://, no port) that the site is
// served from. This MUST match exactly where the frontend is hosted.
//
// IMPORTANT: update RP_ID and ORIGIN below once you know your final domain.
// - For local testing: rpID = 'localhost', origin = 'http://localhost:3000'
// - For your Render deployment: rpID = 'ae-funai-backend.onrender.com',
//   origin = 'https://ae-funai-backend.onrender.com'
// ---------------------------------------------------------------------------
const RP_NAME = 'AE-FUNAI Exam Verification System';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || `http://localhost:${process.env.PORT || 3000}`;

function randomUserId() {
    // WebAuthn wants a stable, opaque user handle — not the matric number
    // itself, for privacy reasons. We generate a random one and store it.
    return Buffer.from(crypto.randomUUID()).toString('base64url');
}
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// REGISTRATION — called when a student sets up fingerprint login for the
// first time on their device (from registration.html).
// ---------------------------------------------------------------------------

/**
 * Step 1 of registration: generate a challenge for the browser to sign.
 */
async function getRegistrationOptions(student) {
    let webauthnUserId = student.webauthn_user_id;
    if (!webauthnUserId) {
        webauthnUserId = randomUserId();
        db.prepare('UPDATE students SET webauthn_user_id = ? WHERE id = ?').run(webauthnUserId, student.id);
    }

    // Don't let a student register the same device/authenticator twice.
    const existingCredentials = db.prepare(
        'SELECT credential_id FROM webauthn_credentials WHERE student_id = ?'
    ).all(student.id);

    const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userID: Buffer.from(webauthnUserId, 'base64url'),
        userName: student.matric_no,
        userDisplayName: student.full_name,
        attestationType: 'none',
        excludeCredentials: existingCredentials.map(c => ({
            id: c.credential_id,
        })),
        authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'required', // forces actual biometric prompt, not just "device present"
            authenticatorAttachment: 'platform', // use the device's built-in sensor (Touch ID/Windows Hello/Android fingerprint), not a USB key
        },
    });

    // Store the challenge temporarily so we can verify it matches in step 2.
    db.prepare('DELETE FROM webauthn_challenges WHERE student_id = ? AND purpose = ?')
      .run(student.id, 'registration');
    db.prepare('INSERT INTO webauthn_challenges (student_id, challenge, purpose) VALUES (?, ?, ?)')
      .run(student.id, options.challenge, 'registration');

    return options;
}

/**
 * Step 2 of registration: verify the browser's response and save the credential.
 */
async function verifyRegistration(student, response) {
    const challengeRow = db.prepare(
        'SELECT * FROM webauthn_challenges WHERE student_id = ? AND purpose = ? ORDER BY id DESC LIMIT 1'
    ).get(student.id, 'registration');

    if (!challengeRow) {
        return { verified: false, message: 'No registration in progress. Please try again.' };
    }

    let verification;
    try {
        verification = await verifyRegistrationResponse({
            response,
            expectedChallenge: challengeRow.challenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
        });
    } catch (err) {
        console.error('WebAuthn registration verification error:', err);
        return { verified: false, message: 'Fingerprint registration failed. Please try again.' };
    }

    db.prepare('DELETE FROM webauthn_challenges WHERE id = ?').run(challengeRow.id);

    if (!verification.verified || !verification.registrationInfo) {
        return { verified: false, message: 'Could not verify fingerprint. Please try again.' };
    }

    // Handle both API shapes across @simplewebauthn/server versions:
    // - v10+: registrationInfo.credential = { id, publicKey, counter }
    // - v9 and earlier: registrationInfo.credentialID / credentialPublicKey / counter (flat)
    const info = verification.registrationInfo;
    const credentialIdValue = info.credential ? info.credential.id : info.credentialID;
    const credentialPublicKeyValue = info.credential ? info.credential.publicKey : info.credentialPublicKey;
    const credentialCounterValue = info.credential ? info.credential.counter : info.counter;

    if (!credentialIdValue || !credentialPublicKeyValue) {
        console.error('WebAuthn registration: could not extract credential from registrationInfo', info);
        return { verified: false, message: 'Could not verify fingerprint. Please try again.' };
    }

    db.prepare(`
        INSERT INTO webauthn_credentials (student_id, credential_id, public_key, counter, device_type, backed_up)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        student.id,
        typeof credentialIdValue === 'string' ? credentialIdValue : Buffer.from(credentialIdValue).toString('base64url'),
        Buffer.from(credentialPublicKeyValue).toString('base64url'),
        credentialCounterValue || 0,
        info.credentialDeviceType,
        info.credentialBackedUp ? 1 : 0
    );

    db.prepare('UPDATE students SET fingerprint_registered = 1 WHERE id = ?').run(student.id);

    return { verified: true, message: 'Fingerprint registered successfully!' };
}

// ---------------------------------------------------------------------------
// AUTHENTICATION — called at exam verification time, when a student proves
// their identity using the fingerprint they registered earlier.
// ---------------------------------------------------------------------------

/**
 * Step 1 of verification: generate a challenge for a specific student
 * (looked up by matric number) to sign with their registered device.
 */
async function getAuthenticationOptions(student) {
    const credentials = db.prepare(
        'SELECT credential_id FROM webauthn_credentials WHERE student_id = ?'
    ).all(student.id);

    if (credentials.length === 0) {
        return { error: 'This student has no registered fingerprint on this device yet.' };
    }

    const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        userVerification: 'required',
        allowCredentials: credentials.map(c => ({ id: c.credential_id })),
    });

    db.prepare('DELETE FROM webauthn_challenges WHERE student_id = ? AND purpose = ?')
      .run(student.id, 'authentication');
    db.prepare('INSERT INTO webauthn_challenges (student_id, challenge, purpose) VALUES (?, ?, ?)')
      .run(student.id, options.challenge, 'authentication');

    return { options };
}

/**
 * Step 2 of verification: verify the signed challenge really came from the
 * student's registered device/fingerprint.
 */
async function verifyAuthentication(student, response) {
    const challengeRow = db.prepare(
        'SELECT * FROM webauthn_challenges WHERE student_id = ? AND purpose = ? ORDER BY id DESC LIMIT 1'
    ).get(student.id, 'authentication');

    if (!challengeRow) {
        return { verified: false, message: 'No verification in progress. Please try again.' };
    }

    const credentialRow = db.prepare(
        'SELECT * FROM webauthn_credentials WHERE student_id = ? AND credential_id = ?'
    ).get(student.id, response.id);

    if (!credentialRow) {
        return { verified: false, message: 'Fingerprint not recognized for this student.' };
    }

    let verification;
    try {
        verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge: challengeRow.challenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
            credential: {
                id: credentialRow.credential_id,
                publicKey: Buffer.from(credentialRow.public_key, 'base64url'),
                counter: credentialRow.counter,
            },
        });
    } catch (err) {
        console.error('WebAuthn authentication verification error:', err);
        return { verified: false, message: 'Fingerprint verification failed. Please try again.' };
    }

    db.prepare('DELETE FROM webauthn_challenges WHERE id = ?').run(challengeRow.id);

    if (!verification.verified) {
        return { verified: false, message: 'Fingerprint did not match.' };
    }

    db.prepare('UPDATE webauthn_credentials SET counter = ? WHERE id = ?')
      .run(verification.authenticationInfo.newCounter, credentialRow.id);

    return { verified: true, message: 'Fingerprint verified.' };
}

module.exports = {
    getRegistrationOptions,
    verifyRegistration,
    getAuthenticationOptions,
    verifyAuthentication,
    RP_ID,
    ORIGIN,
};
