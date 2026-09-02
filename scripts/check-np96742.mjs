const { listJobs } = await import('../.test-build/jobs.js');
const jobs = await listJobs();
console.log('total jobs:', jobs.length);
console.log(jobs.map((j) => `${j.jobId} | ${j.customer} | WO ${j.woNumber} | PO ${j.poNumber} | status ${j.status}`).join('\n'));
const target = jobs.filter((j) => j.jobId === 'NP-96742');
console.log('\nNP-96742 matches:', target.length);
if (target[0]) console.log(JSON.stringify(target[0], null, 1));
