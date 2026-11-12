const {spawnSync}=require('node:child_process');
const r=spawnSync(process.execPath,['--test',require.resolve('../services/containment-security.test.js')],{stdio:'inherit'});
process.exit(r.status ?? 1);
