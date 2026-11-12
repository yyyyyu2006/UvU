// Browser scripts use isolated origins, data and mocked external services.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const jobs=Math.max(1,Math.min(4,Number(option('--jobs',2))||2));
const timeout=Math.max(1000,Number(option('--timeout',180000))||180000);
const match=new RegExp(option('--match','.'),'i');
const entries=fs.readdirSync(__dirname).filter(f=>/^(?:browser_.*|.*_browser)\.cjs$/.test(f)).map(f=>'tests/'+f);
const nested=path.join(__dirname,'browser');
if(fs.existsSync(nested))entries.push(...fs.readdirSync(nested).filter(f=>f.endsWith('.cjs')).map(f=>'tests/browser/'+f));
const files=entries.filter(f=>match.test(f)).sort();
if(!files.length){console.error('No matching browser scripts');process.exit(1);}
if(args.includes('--list')){console.log(files.join('\n'));process.exit(0);}
const out=path.resolve(root,option('--out','outputs/browser-checks-'+new Date().toISOString().replace(/[:.]/g,'-')));
fs.mkdirSync(out,{recursive:true});
const results=[];let cursor=0;
async function worker(){
    while(cursor<files.length){
        const file=files[cursor++],started=Date.now();
        const result=await new Promise(resolve=>{
            const child=spawn(process.execPath,[path.join(root,file)],{cwd:root,env:{...process.env,PLAYWRIGHT_MODULE:process.env.PLAYWRIGHT_MODULE||path.resolve(root,'../uvu-verification-deps/node_modules/playwright')},windowsHide:true});
            let log='',timedOut=false;
            const timer=setTimeout(()=>{
                timedOut=true;
                if(process.platform==='win32')spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>child.kill());
                else child.kill('SIGTERM');
            },timeout);
            child.stdout.on('data',data=>log+=data);child.stderr.on('data',data=>log+=data);
            child.once('error',error=>log+='\n'+error.stack);
            child.once('close',(code,signal)=>{
                clearTimeout(timer);const logFile=file.replaceAll('/','_')+'.log';fs.writeFileSync(path.join(out,logFile),log);
                resolve({file,code,signal,timedOut,ms:Date.now()-started,log:logFile});
            });
        });
        results.push(result);console.log((result.code===0&&!result.timedOut?'PASS ':'FAIL ')+file+' '+result.ms+'ms');
        fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(results.slice().sort((a,b)=>a.file.localeCompare(b.file)),null,2));
    }
}
(async()=>{await Promise.all(Array.from({length:Math.min(jobs,files.length)},()=>worker()));const failed=results.filter(r=>r.code!==0||r.timedOut);console.log(`${results.length-failed.length}/${files.length} passed; ${failed.length} failed; logs: ${out}`);process.exitCode=failed.length?1:0;})().catch(error=>{console.error(error);process.exitCode=1;});
