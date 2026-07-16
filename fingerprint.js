// fingerprint.js
//
// This file is the ONE place where fingerprint hardware logic lives.
// Everything else in the backend (routes, db, etc.) is fully working today.
// This file is currently a clearly-labeled placeholder — swap in the real
// SecuGen WebAPI 1:N calls here and nothing else in the codebase needs to change.
//
// ---------------------------------------------------------------------------
// HOW THIS WILL WORK WITH SECUGEN WEBAPI 1:N (once the scanner arrives):
//
// 1. Install the SecuGen WebAPI 1:N local service on the exam-hall PC.
//    This runs its own local server (typically https://localhost:8443 or
//    similar — check the installer's docs) alongside your Node backend.
//
// 2. ENROLLMENT (student registration page):
//    - Frontend JS calls the SecuGen WebAPI JavaScript client to capture a
//      scan and get back a template (base64 string).
//    - Frontend sends that template to POST /api/students (this backend).
//    - This backend calls registerFingerprintTemplate() below, which calls
//      SecuGen's RegisterFP (via their WebAPI 1:N REST endpoint) to add the
//      template to the in-memory SecuSearch database, tagged with the
//      student's DB id.
//    - The template is also stored in our own SQLite `students` table as a
//      backup/record (SecuSearch's in-memory index rebuilds from this on
//      restart — see reloadAllTemplatesIntoSecuSearch() below).
//
// 3. VERIFICATION (exam-verification page):
//    - Frontend JS captures a scan via SecuGen WebAPI and gets a template.
//    - Frontend sends it to POST /api/verify (this backend).
//    - This backend calls identifyFingerprint() below, which calls SecuGen's
//      IdentifyFP against the SecuSearch in-memory database and gets back
//      either a matched template id (-> student id) or "no match".
//
// Until the scanner is connected, both functions below are simulated so the
// rest of the app (dashboard, registration, verification pages) is fully
// testable end-to-end.
// ---------------------------------------------------------------------------

const SIMULATION_MODE = true; // set to false once SecuGen WebAPI is wired in

/**
 * Registers a fingerprint template for a student.
 * @param {number} studentId - the student's DB id
 * @param {string} template - base64 fingerprint template from the scanner
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function registerFingerprintTemplate(studentId, template) {
    if (SIMULATION_MODE) {
        // Simulated: just accept whatever "template" string came in.
        // Real version: call SecuGen WebAPI 1:N's RegisterFP endpoint here, e.g.
        //
        //   const response = await fetch('https://localhost:8443/SGIFPCapture/RegisterFP', {
        //       method: 'POST',
        //       headers: { 'Content-Type': 'application/json' },
        //       body: JSON.stringify({ id: studentId, template })
        //   });
        //   const result = await response.json();
        //   return { success: result.ErrorCode === 0, message: result.ErrorCode === 0 ? 'Registered' : result.ErrorMessage };

        if (!template || template.length < 10) {
            return { success: false, message: 'Invalid or missing fingerprint template.' };
        }
        return { success: true, message: 'Fingerprint template registered (simulated).' };
    }

    throw new Error('SecuGen WebAPI integration not yet implemented. Set SIMULATION_MODE = true or implement this function.');
}

/**
 * Attempts to identify a student from a freshly scanned fingerprint template,
 * matching it against all enrolled students (1:N).
 * @param {string} scannedTemplate - base64 fingerprint template from the scanner
 * @param {Array<{id: number, fingerprint_template: string}>} enrolledStudents
 * @returns {Promise<{matched: boolean, studentId: number|null, reason: string}>}
 */
async function identifyFingerprint(scannedTemplate, enrolledStudents) {
    if (SIMULATION_MODE) {
        // Simulated: 80% chance of "matching" a random enrolled student.
        // Real version: call SecuGen WebAPI 1:N's IdentifyFP endpoint here, e.g.
        //
        //   const response = await fetch('https://localhost:8443/SGIFPCapture/IdentifyFP', {
        //       method: 'POST',
        //       headers: { 'Content-Type': 'application/json' },
        //       body: JSON.stringify({ template: scannedTemplate, securityLevel: 5 })
        //   });
        //   const result = await response.json();
        //   if (result.MatchFound) {
        //       return { matched: true, studentId: result.TemplateId, reason: 'Match found' };
        //   }
        //   return { matched: false, studentId: null, reason: 'No match found' };

        if (!scannedTemplate) {
            return { matched: false, studentId: null, reason: 'No fingerprint data received.' };
        }
        if (enrolledStudents.length === 0) {
            return { matched: false, studentId: null, reason: 'No enrolled students to match against.' };
        }

        const successRate = 0.8;
        const isMatch = Math.random() < successRate;

        if (isMatch) {
            const randomStudent = enrolledStudents[Math.floor(Math.random() * enrolledStudents.length)];
            return { matched: true, studentId: randomStudent.id, reason: 'Match found (simulated)' };
        }
        return { matched: false, studentId: null, reason: 'Fingerprint not recognized (simulated).' };
    }

    throw new Error('SecuGen WebAPI integration not yet implemented. Set SIMULATION_MODE = true or implement this function.');
}

module.exports = { registerFingerprintTemplate, identifyFingerprint, SIMULATION_MODE };
