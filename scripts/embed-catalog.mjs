import fs from 'node:fs';
import {validateCatalog} from '../history-api/worker.mjs';
const path=new URL('../index.html',import.meta.url),html=fs.readFileSync(path,'utf8').replace(/\r\n/g,'\n');
const match=html.match(/<script id="catalogCode">\n([\s\S]*?)\n<\/script>/);
if(!match)throw new Error('catalogCode block is missing');
const old=match[1].split('\n'),next=(validateCatalog.toString()+'\n'+fs.readFileSync(new URL('./catalog-ui.js',import.meta.url),'utf8').replace(/\r\n/g,'\n')).split('\n');
if(old.join('\n')===next.join('\n')){console.log('Embedded catalog editor is current.');process.exit(0)}
if(!process.argv.includes('--patch')){console.error('The embedded catalog editor needs updating. Use --patch to print an apply_patch patch.');process.exit(1)}
const dp=Array.from({length:old.length+1},()=>new Uint32Array(next.length+1));
for(let i=old.length-1;i>=0;i--)for(let j=next.length-1;j>=0;j--)dp[i][j]=old[i]===next[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
let i=0,j=0,ops=[];
while(i<old.length||j<next.length){if(i<old.length&&j<next.length&&old[i]===next[j]){ops.push([' ',old[i]]);i++;j++}else if(j<next.length&&(i===old.length||dp[i][j+1]>=dp[i+1][j]))ops.push(['+',next[j++]]);else ops.push(['-',old[i++]])}
let hunks=[],p=0;
while(p<ops.length){if(ops[p][0]===' '){p++;continue}let start=Math.max(0,p-2),last=p;while(p<ops.length){if(ops[p][0]!==' ')last=p;if(p-last>4)break;p++}const end=Math.min(ops.length,last+3);hunks.push('@@\n'+ops.slice(start,end).map(([sign,line])=>sign+line).join('\n'));p=end}
console.log('*** Begin Patch\n*** Update File: '+decodeURIComponent(path.pathname).replace(/^\/([A-Za-z]:)/,'$1')+'\n'+hunks.join('\n')+'\n*** End Patch');
