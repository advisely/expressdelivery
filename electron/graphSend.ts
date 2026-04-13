// graphSend.ts — Microsoft Graph POST /me/sendMail implementation.
//
// Stub created during Task 11 (sendMail dispatcher) so the ./graphSend.js
// import resolves. Full implementation lands in Task 13.

import type { SendMailParams, SendMailResult } from './sendMail.js';

export async function sendViaGraph(
    params: SendMailParams,
    accessToken: string,
): Promise<SendMailResult> {
    throw new Error(
        `sendViaGraph: not yet implemented (Task 13) — account=${params.accountId} tokenLen=${accessToken.length}`,
    );
}
