#!/usr/bin/node
const net = require('node:net');

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

// Song string: notes are represented by letters, rests by "-"
const song = "ECEAF---DBDGE-DC-C-AD-A--D-CE-D-ECEAF--FDBDGE-DC-ACAD-A-DDDCE-D-CCAGCCAGG-E-C-AGCCAGCCAG-AGA-AGA"

// Starting position for the first note block
let currentX = 100; // Adjust starting X coordinate as needed
const startY = 150; // Adjust starting Y coordinate as needed (ground level)
const startZ = 500; // Adjust starting Z coordinate as needed

// Note to Minecraft note mapping (simplified, example values)
const noteMappings = {
  'a': 3,
  'b': 6,
  'c': 6,
  'd': 8,
  'e': 10,
  'f': 11,
  'g': 13,
  'A': 3+12,
  'B': 6+12,
  'C': 6+12,
  'D': 8+12,
  'E': 10+12,
  'F': 11+12,
  'G': 13+12,
};

song.split('').forEach(char => {
  if (char === '-') {
    // Place a stone block for a rest
    setBlock('minecraft:stone', currentX, startY, startZ);
  } else {
    // Place a note block for a note, if the note is defined in noteMappings
    const note = noteMappings[char];
    if (note !== undefined) {
      setBlock(`minecraft:note_block[note=${note}]`, currentX, startY, startZ);
    }
  }
  setBlock('minecraft:stone', currentX+1, startY, startZ);

  setBlock('minecraft:stone', currentX,   startY-1, startZ+1);
  setBlock('minecraft:stone', currentX,   startY-1, startZ+2);
  setBlock('minecraft:stone', currentX+1, startY-1, startZ+1);
  setBlock('minecraft:stone', currentX+1, startY-1, startZ+2);

  setBlock('minecraft:repeater[facing=south]', currentX,   startY, startZ+1);
  setBlock('minecraft:redstone_wire', currentX,   startY, startZ+2);
  setBlock('minecraft:repeater[facing=west,delay=3]', currentX+1,   startY, startZ+2);

  // Move to the next position (note block, stone, note block)
  currentX += 2;
});


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
  },200); // Adjust delay as necessary to avoid flooding the server
}

function setBlock( type, x, y, z) {
  enqueueCommand(`setBlock ${x} ${y} ${z} ${type}\n`);
}

