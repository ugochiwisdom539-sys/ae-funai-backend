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

const crypto = require('crypto');
const { db } = require('./db');

// ---------------------------------------------------------------------------
// Relying Party (RP) config — identifies YOUR site to the browser's WebAuthn
// API. rpID must be the bare domain (no https://, no port) that the site is
// served from. This MUST match exactly where the frontend is hosted.
// Set RP_ID and ORIGIN as environment variables in your Render dashboard.
// ---------------------------------------------------------------------------
const RP_NAME = 'AE-FUNAI Exam Verification System';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || `http://localhost:${process.env.PORT || 3000}`;

function randomUserId() {
    return Buffer.from(crypto.randomUUID()).toString('base64url');
}

// ---------------------------------------------------------------------------
// REGISTRATION
// ---------------------------------------------------------------------------

async function getRegistrationOptions(student) {
    let webauthnUserId = student.webauthn_user_id;
    if (!webauthnUserId) {
        webauthnUserId = randomUserId();
        await db.prepare('UPDATE students SET webauthn_user_id = ? WHERE id = ?').run(webauthnUserId, student.id);
    }

    const existingCredentials = await db.prepare(
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
            userVerification: 'required',
            authenticatorAttachment: 'platform',
        },
    });

    await db.prepare('DELETE FROM webauthn_challenges WHERE student_id = ? AND purpose = ?')
        .run(student.id, 'registration');
    await db.prepare('INSERT INTO webauthn_challenges (student_id, challenge, purpose) VALUES (?, ?, ?)')
        .run(student.id, options.challenge, 'registration');

    return options;
}

async function verifyRegistration(student, response) {
    const challengeRow = await db.prepare(
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

    await db.prepare('DELETE FROM webauthn_challenges WHERE id = ?').run(challengeRow.id);

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

    await db.prepare(`
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

    await db.prepare('UPDATE students SET fingerprint_registered = 1 WHERE id = ?').run(student.id);

    return { verified: true, message: 'Fingerprint registered successfully!' };
}

// ---------------------------------------------------------------------------
// AUTHENTICATION
// ---------------------------------------------------------------------------

async function getAuthenticationOptions(student) {
    const credentials = await db.prepare(
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

    await db.prepare('DELETE FROM webauthn_challenges WHERE student_id = ? AND purpose = ?')
        .run(student.id, 'authentication');
    await db.prepare('INSERT INTO webauthn_challenges (student_id, challenge, purpose) VALUES (?, ?, ?)')
        .run(student.id, options.challenge, 'authentication');

    return { options };
}

async function verifyAuthentication(student, response) {
    const challengeRow = await db.prepare(
        'SELECT * FROM webauthn_challenges WHERE student_id = ? AND purpose = ? ORDER BY id DESC LIMIT 1'
    ).get(student.id, 'authentication');

    if (!challengeRow) {
        return { verified: false, message: 'No verification in progress. Please try again.' };
    }

    const credentialRow = await db.prepare(
        'SELECT * FROM webauthn_credentials WHERE student_id = ? AND credential_id = ?'
    ).get(student.id, response.id);

    if (!credentialRow) {
        return { verified: false, message: 'Fingerprint not recognized for this student.' };
    }

    const publicKeyBuffer = Buffer.from(credentialRow.public_key, 'base64url');

    let verification;
    try {
        verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge: challengeRow.challenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
            // Provide both shapes — newer @simplewebauthn/server versions read
            // `credential`, older versions read `authenticator`. Sending both
            // means this works regardless of which version is actually installed.
            credential: {
                id: credentialRow.credential_id,
                publicKey: publicKeyBuffer,
                counter: credentialRow.counter,
            },
            authenticator: {
                credentialID: credentialRow.credential_id,
                credentialPublicKey: publicKeyBuffer,
                counter: credentialRow.counter,
            },
        });
    } catch (err) {
        console.error('WebAuthn authentication verification error:', err);
        return { verified: false, message: 'Fingerprint verification failed. Please try again.' };
    }

    await db.prepare('DELETE FROM webauthn_challenges WHERE id = ?').run(challengeRow.id);

    if (!verification.verified) {
        return { verified: false, message: 'Fingerprint did not match.' };
    }

    const newCounter = verification.authenticationInfo
        ? verification.authenticationInfo.newCounter
        : verification.newCounter;

    await db.prepare('UPDATE webauthn_credentials SET counter = ? WHERE id = ?')
        .run(newCounter, credentialRow.id);

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
