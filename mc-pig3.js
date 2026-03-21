#!/usr/bin/node
const net = require('node:net');
const client = net.createConnection({ port: 7070 }, () => {
  console.log('connected to server!');
});

client.on('data', (data) => {
console.log( "SERVER: "+data )
  // Handle data from the server, if necessary
});

client.on('end', () => {
  console.log('disconnected from server');
  process.exit(0);
});

const commandQueue = [];
let isProcessingQueue = false;

client.on('connect', () => {
  draw3DPig(400, 200, 300); // Adjust starting coordinates as needed
});


function draw3DPig(x, y, z) {
  // Body
  fillArea(x + 1, y, z + 1, x + 6, y + 4, z + 10, "minecraft:pink_wool");
  // Head
  fillArea(x + 7, y + 1, z + 4, x + 9, y + 3, z + 7, "minecraft:pink_wool");
  // Eyes
  setBlock(x + 9, y + 3, z + 5, "minecraft:black_wool");
  setBlock(x + 9, y + 3, z + 6, "minecraft:black_wool");
  // Legs
  fillArea(x, y - 1, z + 1, x + 1, y, z + 2, "minecraft:pink_wool");
  fillArea(x, y - 1, z + 9, x + 1, y, z + 10, "minecraft:pink_wool");
  fillArea(x + 6, y - 1, z + 1, x + 7, y, z + 2, "minecraft:pink_wool");
  fillArea(x + 6, y - 1, z + 9, x + 7, y, z + 10, "minecraft:pink_wool");
  processQueue();
}

function fillArea(x1, y1, z1, x2, y2, z2, blockType) {
  for (let x = x1; x <= x2; x++) {
    for (let y = y1; y <= y2; y++) {
      for (let z = z1; z <= z2; z++) {
        setBlock(x, y, z, blockType);
      }
    }
  }
}

function enqueueCommand(command) {
  commandQueue.push(command);
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
console.log( 'queue clear')
      return;
    }
    const command = commandQueue.shift();
console.log( "C:"+command )
    client.write(command);
  },50); // Adjust delay as necessary to avoid flooding the server
}

function setBlock(x, y, z, type) {
  enqueueCommand(`setBlock ${x} ${y} ${z} ${type}\n`);
  if (!isProcessingQueue) {
    processQueue();
  }
}

