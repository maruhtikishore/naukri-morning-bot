import { sendWhatsApp } from './notify.js';

const r = await sendWhatsApp('Naukri bot test: if you can read this, phone summaries are working.');
console.log(r.ok ? 'Sent.' : 'Failed.', r.detail);
process.exitCode = r.ok ? 0 : 1;
