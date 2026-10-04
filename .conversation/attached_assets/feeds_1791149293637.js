import { readFile } from 'node:fs/promises';
import Parser from 'rss-parser';
import { connect } from './discord.js';
import { pool,locked,resource,audit } from './db.js';
const feeds=JSON.parse(await readFile(new URL('../feeds.json',import.meta.url),'utf8'));
const {client,guild}=await connect();
const parser=new Parser({timeout:15000});
try {
  for (const feed of feeds.filter(f=>f.enabled)) {
    try {
      if (!['faith-news','gaming-news','tech-news'].includes(feed.channel) || !feed.url.startsWith('https://')) throw new Error('Invalid feed destination or URL');
      // Only trusted operator-edited public feed URLs belong in this file.
      const data=await parser.parseURL(feed.url);
      await locked(`feed:${guild.id}:${feed.id}`,async db=>{
        const channel=await guild.channels.fetch(await resource('channel',feed.channel));
        for (const item of data.items.slice(0,5).reverse()) {
          const id=item.guid||item.link; if (!id || !item.link?.startsWith('https://')) continue;
          if ((await db.query('SELECT 1 FROM feed_items WHERE guild_id=$1 AND feed_id=$2 AND item_id=$3',[guild.id,feed.id,id])).rowCount) continue;
          await channel.send({content:`${String(item.title||'New update').replace(/<[^>]*>/g,'').slice(0,250)}\n<${item.link}>`.slice(0,1900),allowedMentions:{parse:[]}});
          await db.query('INSERT INTO feed_items VALUES($1,$2,$3,now())',[guild.id,feed.id,id]);
        }
        await audit(db,client.user.id,'feed_poll',{feed:feed.id});
      });
    } catch(e) {console.error(`Feed ${feed.id} failed: ${e.message}`);process.exitCode=1;}
  }
} finally {client.destroy();await pool.end();}
