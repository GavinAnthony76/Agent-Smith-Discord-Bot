import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import Parser from 'rss-parser';

export const FEED_LIMITS = Object.freeze({ bytes: 1048576, timeout: 15000, redirects: 3, items: 5, sources: 25 });
const parser = new Parser();

// Accept only globally routable addresses. IPv6 transition/mapped ranges are
// deliberately not accepted: their embedded IPv4 can reach private services.
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 192 && b === 0) || (a === 192 && b === 88 && c === 99)
      || (a === 198 && [18,19].includes(b)) || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const normalized=new URL(`https://[${address}]/`).hostname.slice(1,-1);
    const [first,second]=normalized.split(':').map(v=>parseInt(v,16));
    return first >= 0x2000 && first <= 0x3fff
      && !(first===0x2001 && (second<0x200 || second===0xdb8))
      && first!==0x2002 && first!==0x3fff;
  }
  return false;
}

export function publicURL(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) throw new Error('A bounded public HTTPS URL is required.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid HTTPS URL.'); }
  const host = url.hostname.replace(/^\[|\]$/g,'');
  if (url.protocol !== 'https:' || url.username || url.password || url.hash
    || (url.port && url.port !== '443') || !host.includes('.') && !isIP(host)
    || /(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(host)
    || /REPLACE/i.test(value) || (isIP(host) && !publicAddress(host))) {
    throw new Error('Only public HTTPS URLs on port 443, without credentials or fragments, are permitted.');
  }
  return url;
}

export async function resolvePublic(value, { resolver = lookup, signal } = {}) {
  const url = publicURL(value), host = url.hostname.replace(/^\[|\]$/g,'');
  const records = isIP(host) ? [{address:host,family:isIP(host)}]
    : await Promise.race([
      resolver(host,{all:true,verbatim:true}),
      ...(signal ? [new Promise((_,reject)=>{
        if(signal.aborted)return reject(new Error('Feed deadline exceeded.'));
        signal.addEventListener('abort',()=>reject(new Error('Feed deadline exceeded.')),{once:true});
      })] : [])
    ]);
  if (!records.length || records.some(r=>!publicAddress(r.address))) throw new Error('Source DNS must resolve exclusively to public addresses.');
  return {url,address:records[0]};
}

function requestPinned({url,address},signal) {
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{
      agent:false,signal,
      headers:{Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml', 'Accept-Encoding':'identity','User-Agent':'Agent-Smith-Feeds/1.0'},
      // The TLS hostname stays the original hostname; only the connection IP
      // is pinned to the already checked DNS answer.
      lookup(_host,options,callback) {
        callback(null,...(options?.all ? [[address]] : [address.address,address.family]));
      }
    },response=>{
      if ([301,302,303,307,308].includes(response.statusCode)) {
        const location=response.headers.location;
        response.destroy();resolve({location});return;
      }
      if(response.statusCode!==200 || (response.headers['content-encoding'] && response.headers['content-encoding']!=='identity')) {
        response.destroy();reject(new Error('Feed must return uncompressed HTTP 200.'));return;
      }
      if(Number(response.headers['content-length'])>FEED_LIMITS.bytes) {
        response.destroy();reject(new Error('Feed exceeds size limit.'));return;
      }
      const chunks=[];let size=0;
      response.on('data',chunk=>{
        size+=chunk.length;
        if(size>FEED_LIMITS.bytes){response.destroy(new Error('Feed exceeds size limit.'));return;}
        chunks.push(chunk);
      });
      response.on('error',reject);
      response.on('end',()=>resolve({xml:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error',reject);
  });
}

export async function fetchFeed(value, { resolver = lookup, request = requestPinned, timeout = FEED_LIMITS.timeout } = {}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try {
    let next=value;
    for(let redirects=0;redirects<=FEED_LIMITS.redirects;redirects++) {
      const target=await resolvePublic(next,{resolver,signal:controller.signal});
      const response=await request(target,controller.signal);
      if(controller.signal.aborted)throw new Error('Feed deadline exceeded.');
      if(response.location) {next=new URL(response.location,target.url).href;continue;}
      if(typeof response.xml!=='string' || Buffer.byteLength(response.xml)>FEED_LIMITS.bytes
        || /<!DOCTYPE|<!ENTITY/i.test(response.xml))throw new Error('Oversized feed or XML entities are not permitted.');
      const data=await parser.parseString(response.xml);
      return (data.items??[]).slice(0,FEED_LIMITS.items).reverse().flatMap(item=>{
        try {
          const link=publicURL(item.link).href;
          const id=String(item.guid||link);
          if(!id || id.length>2048)return [];
          const title=String(item.title||'New update').replace(/<[^>]*>/g,'').replace(/[\r\n]/g,' ').slice(0,250);
          return [{id,link,title,content:`${title}\n<${link}>`.slice(0,1900)}];
        } catch {return [];}
      });
    }
    throw new Error('Too many feed redirects.');
  } finally {clearTimeout(timer);}
}
