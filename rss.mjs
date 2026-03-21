// Simulate fetching a headline from an RSS feed and converting it into a 2D array

import fetch from 'node-fetch'
import {parseStringPromise} from 'xml2js'

import net from 'node:net';

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const lettermap = require("./lettermap.json");

// Adjust these to your server's settings
const host = 'localhost';
const port = 7070;

const commandQueue = [];
let isProcessingQueue = false;

const client = net.createConnection({ host, port }, () => {
  console.log('Connected to Minecraft server!');
});

client.on('error', (err) => {
  console.error('Connection error:', err);
});

client.on('end', () => {
  console.log('Disconnected from server');
});


const rssUrl = 'https://feeds.bbci.co.uk/news/rss.xml'
getRssTitles(rssUrl).then( (titles)=>{
	let z = -30000
	console.log( titles)
	titles.forEach( (title)=>{
		const asciiArtText = textToAsciiArt(title.toUpperCase())
		setPic(0, 150, z, asciiArtText );
		z-=50
	})
})


//////////////////////////////

function textToAsciiArt(text) {
	const words = text.split( / / )
	let MAX = 150
	const blankrow = ' '.repeat(MAX)
	const wordsArt = words.map( word=>wordToAsciiArt(word+" ") )
  	const output = [blankrow, ' ', ' ', ' ', ' ', ' '];
	let y = 1
	wordsArt.forEach( (wordArt)=>{
		if( wordArt[0].length + output[y].length > MAX ) {
  			output.push( blankrow, ' ', ' ', ' ', ' ', ' ' )
			y += 6
		}
		wordArt.forEach( (line,index) => output[index+y]+=wordArt[index] )
	})
	output.push(blankrow)
	return output.map( line=>{

		const needed = MAX+2-line.length
		return line+' '.repeat(needed)
	})
}

function wordToAsciiArt(text) {
  const output = ['', '', '', '', ''];
  
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    const asciiArt = lettermap[character.charCodeAt(0)];

    if (asciiArt) {
      asciiArt.forEach((line, index) => {
        output[index] += line + ' ';
      });
    }
  }

  return output;
}




async function getRssTitles(rssUrl) {
  try {
    const response = await fetch(rssUrl);
    const xmlData = await response.text();
    const result = await parseStringPromise(xmlData, { trim: true, normalize: true });
    const titles = result.rss.channel[0].item.map( (item)=>item.title[0] )
    return titles;
  } catch (error) {
    console.error('Error fetching or parsing RSS feed:', error);
    return null;
  }
}

function setPic( x,y,z, pic ) {
  for( let yo=0; yo<pic.length; yo++ ) {
    for( let xo=0; xo<pic[yo].length; xo++ ) {
      if( pic[yo][xo] == " " ) {
        setBlock(x+xo, y+pic.length-1-yo, z, "minecraft:black_concrete" );
      }
      else {
        setBlock(x+xo, y+pic.length-1-yo, z, "minecraft:white_concrete" );
      }
    }
  }
}

function enqueueCommand(command) {
  commandQueue.push(command);
  processQueue();
}

function processQueue() {
  if (isProcessingQueue || commandQueue.length === 0) {
    return;
  }
  isProcessingQueue = true;
  const intervalId = setInterval(() => {
    if (commandQueue.length === 0) {
      clearInterval(intervalId);
      isProcessingQueue = false;
      return;
    }
    const command = commandQueue.shift();
    client.write(command);
  console.log(command)
  },5); // Adjust delay as necessary to avoid flooding the server
}

function setBlock( x, y, z, type) {
  enqueueCommand(`setBlock ${x} ${y} ${z} ${type}\n`);
}
