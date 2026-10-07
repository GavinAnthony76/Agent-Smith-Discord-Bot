import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publicAddress, publicURL, resolvePublic, fetchFeed, FEED_LIMITS } from '../src/feed-http.js';
import { validateSource } from '../src/feed-store.js';
import { createSmithControl, smithControlCommand } from '../src/smith-control.js';

test('feed URL and IP policy blocks internal, encoded, reserved and transition destinations',async()=>{
  for(const address of ['0.0.0.0','10.1.2.3','127.0.0.1','100.64.0.1','169.254.169.254','172.16.0.1',
    '192.168.1.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255',
    '::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2001:0db8::1','2001:10::1','2002:7f00:1::','3fff::1']) {
    assert.equal(publicAddress(address),false,address);
  }
  for(const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888'])assert.equal(publicAddress(address),true,address);
  for(const url of ['http://news.com/rss','https://localhost/rss','https://service.internal/rss','https://127.1/rss',
    'https://2130706433/rss','https://0x7f000001/rss','https://user:password@news.com/rss','https://news.com:444/rss',
    'https://[::ffff:127.0.0.1]/rss','https://news.com/rss#x','https://news.com\\@127.0.0.1/rss','https://REPLACE-WITH-PUBLISHER-FEED']) {
    assert.throws(()=>publicURL(url),undefined,url);
  }
  await assert.rejects(resolvePublic('https://news.com/rss',{resolver:async()=>[
    {address:'8.8.8.8',family:4},{address:'10.1.1.1',family:4}]}),/public/);
});

test('fetch revalidates redirects, pins checked DNS, caps XML and suppresses invalid item links',async()=>{
  let calls=0,lookups=0;
  const resolver=async()=>{lookups++;return [{address:'8.8.8.8',family:4}];};
  const request=async({url,address})=>{
    calls++;assert.equal(address.address,'8.8.8.8');
    if(url.hostname==='start.com')return {location:'https://news.com/rss'};
    return {xml:`<rss version="2.0"><channel><title>News</title><link>https://news.com/</link><description>Feed</description>
      <item><guid>one</guid><title><![CDATA[<b>@everyone news</b>]]></title><link>https://news.com/one</link></item>
      <item><guid>two</guid><title>Unsafe</title><link>https://127.0.0.1/admin</link></item>
      </channel></rss>`};
  };
  const items=await fetchFeed('https://start.com/rss',{resolver,request});
  assert.equal(calls,2);assert.equal(lookups,2);assert.equal(items.length,1);
  assert.equal(items[0].content,'@everyone news\n<https://news.com/one>');
  await assert.rejects(fetchFeed('https://start.com/rss',{resolver,request:async()=>({location:'https://169.254.169.254/x'})}),/public HTTPS/);
  await assert.rejects(fetchFeed('https://start.com/rss',{resolver,request:async()=>({location:'https://news.com/rss'})}),/redirects/);
  await assert.rejects(fetchFeed('https://news.com/rss',{resolver,request:async()=>({xml:'<!DOCTYPE rss [<!ENTITY x "bad">]><rss/>'})}),/entities/);
  await assert.rejects(fetchFeed('https://news.com/rss',{resolver,request:async()=>({xml:'x'.repeat(FEED_LIMITS.bytes+1)})}),/Oversized/);
  await assert.rejects(fetchFeed('https://news.com/rss',{resolver:()=>new Promise(()=>{}),timeout:10}),/deadline/);
});

test('source options and command surface are bounded, framework-only and optional-thread by default',async()=>{
  assert.deepEqual(validateSource({id:'faith',url:'https://news.com/rss',destination:'faith-news'}),
    {id:'faith',url:'https://news.com/rss',destination:'faith-news',interval:15,threads:false});
  for(const input of [
    {id:'../bad'}, {destination:'general'}, {interval:1}, {interval:1441}, {threads:'true'}
  ])assert.throws(()=>validateSource({id:'good',url:'https://news.com/rss',destination:'tech-news',...input}));
  const commands=smithControlCommand.toJSON();
  assert.ok(commands.options.find(o=>o.name==='feed-enable'));
  assert.ok(commands.options.find(o=>o.name==='feed-resolve'));
  const source=await readFile(new URL('../src/feeds.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from ['"]\.\/discord\.js['"]|new Client/);
  const cli=await readFile(new URL('../src/feed-cli.js',import.meta.url),'utf8');
  assert.doesNotMatch(cli,/import.*discord/);
});

test('feed controls refuse non-Owner and wrong-channel actions without touching worker',async()=>{
  let actions=0;
  const guild={id:'guild',ownerId:'owner',async fetch(){return guild;}};
  const control=createSmithControl({guild,cfg:{owners:['owner'],ownerDiscordId:'owner'},pool:{},
    resource:async()=> 'controls',feeds:{async save(){actions++;}}});
  for(const [userId,channelId] of [['member','controls'],['owner','general']]) {
    let reply;
    const i={guildId:'guild',user:{id:userId,bot:false},channelId,options:{getSubcommand:()=> 'feed-save'},
      async reply(r){reply=r;}};
    await control.handle(i);assert.match(reply.content,/Unable to complete/);
  }
  assert.equal(actions,0);
});
