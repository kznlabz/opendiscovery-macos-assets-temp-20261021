import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const input=path.resolve(process.argv.find(a=>a.endsWith('macos-inputs.json'))||path.join(here,'macos-inputs.json'));
const bundle=JSON.parse(fs.readFileSync(input));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const required=[
 'scripts/generate-macos-icon-assets.cjs',
 'resources/icons/AppIcon.icon/icon.json',
 'resources/icons/AppIcon.icon/Assets/app-icon-glyph-light 2.png',
 'resources/icons/AppIcon.icon/Assets/app-icon-glyph-dark 4.png',
];
if(bundle.product!=='OpenDiscovery'||bundle.foldCount!==3)throw Error('Unexpected icon bundle');
if(JSON.stringify(bundle.files.map(f=>f.path).sort())!==JSON.stringify(required.sort()))throw Error('Bundle file inventory differs from expected inputs');
const decoded=bundle.files.map(f=>{
 const data=Buffer.from(f.base64,'base64');if(sha(data)!==f.sha256)throw Error('Input digest mismatch: '+f.path);
 if(f.path.endsWith('.png')){
  if(data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||data.readUInt32BE(16)!==1024||data.readUInt32BE(20)!==1024)throw Error('Expected 1024px PNG layer');
 }
 return {...f,data};
});
if(process.argv.includes('--check-inputs')){console.log('Validated four source-bound Mac icon inputs; geometry '+bundle.geometryHash);process.exit(0);}
if(process.platform!=='darwin')throw Error('Run the compile step on a macOS GitHub runner with Xcode. Input validation works on any platform.');
const staging=fs.mkdtempSync(path.join(os.tmpdir(),'opendiscovery-mac-icon-'));
const out=path.resolve('macos-output');fs.mkdirSync(out,{recursive:true});
try{
 for(const f of decoded){const dest=path.join(staging,f.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,f.data);}
 execFileSync(process.execPath,[path.join(staging,'scripts/generate-macos-icon-assets.cjs')],{stdio:'inherit'});
 const car=fs.readFileSync(path.join(staging,'resources/icons/Assets.car'));
 if(car.length<1024)throw Error('Compiled catalogue is unexpectedly small');
 fs.writeFileSync(path.join(out,'Assets.car'),car);
 const info=execFileSync('xcrun',['assetutil','--info',path.join(out,'Assets.car')],{encoding:'utf8',maxBuffer:16*1024*1024});
 const parsed=JSON.parse(info);if(!Array.isArray(parsed)||parsed.length<2)throw Error('assetutil returned no rendition records');
 fs.writeFileSync(path.join(out,'assetutil-info.json'),info+'\n');
 const provenance={product:'OpenDiscovery',geometryHash:bundle.geometryHash,foldCount:3,inputBundleSha256:sha(fs.readFileSync(input)),inputs:bundle.files.map(({path,sha256})=>({path,sha256})),catalogueSha256:sha(car),xcode:execFileSync('xcodebuild',['-version'],{encoding:'utf8'}).trim(),macOS:execFileSync('sw_vers',['-productVersion'],{encoding:'utf8'}).trim(),commit:process.env.GITHUB_SHA||null,runId:process.env.GITHUB_RUN_ID||null,assetutilParsed:true,nativeInstalledVerification:'not-run'};
 fs.writeFileSync(path.join(out,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
 const sums=['Assets.car','assetutil-info.json','provenance.json'].map(n=>sha(fs.readFileSync(path.join(out,n)))+'  '+n).join('\n');fs.writeFileSync(path.join(out,'SHA256SUMS'),sums+'\n');
 console.log('Compiled Apple catalogue and validated it with assetutil. SHA256 '+sha(car));
}finally{fs.rmSync(staging,{recursive:true,force:true});}
