
const { spawn } = require('node:child_process')
const net = require('net')

const port = 7070
const host = '127.0.0.1'

process.on('uncaughtException', function (err) {
  console.error(err.stack);
  console.log("Node NOT Exiting...");
});

const server = net.createServer()
server.listen(port, host, () => {
  process.stdout.write('TCP Server is running on port ' + port +'.\n')
})

const java = '/usr/lib/jvm/java-22-openjdk-22.0.2.0.9-1.rolling.el9.x86_64/bin/java'
const spigot = 'spigot-1.21.1.jar'

const minecraft = spawn(`cd ..; ${java} -jar ${spigot} `, { shell:true})
let serverReady = false;

minecraft.stdout.on('data', (data) => {
  const dataString = data.toString();
  if( dataString.match( /\[Server thread\/INFO\]: Done/ ) ) {
    serverReady = true;
    sendAll( '$SERVER_READY='+serverReady+"\n" )
    process.stdout.write('READY\n')
  }
  process.stdout.write(dataString)
  //sendAll(dataString)
})

minecraft.stderr.on('data', (data) => {
  console.error(`stderr: ${data}`)
  sendAll(`stderr: ${data}`)
})

minecraft.on('close', (code) => {
  process.stdout.write(`child process exited with code ${code}\n`)
  process.exit()
})

process.stdin.on( 'data', function(data) {
    minecraft.stdin.write( data )
})

setInterval( updateBlocks, 100 );

const blocksToSet = {};
const managedBlocks = {};

// ensure updating blocks isn't, heh, blocking
function updateBlocks() {
  var coords = Object.keys(blocksToSet);
  if( coords.length==0 ) { return; }
  const nextCoord = coords[0];
  const type = blocksToSet[nextCoord];
  delete blocksToSet[nextCoord];

  // if it should already be set, do nothing
  if( managedBlocks[nextCoord] !== type ) {
      minecraft.stdin.write( `setblock ${nextCoord} ${type} replace\n` )
      console.log( `setblock ${nextCoord} ${type} replace` )
      managedBlocks[nextCoord] = type
  }
  setInterval( updateBlocks, 1 );
}







let sockets = []

function sendAll( msg ) {
    sockets.forEach(function(sockI, index, array) {
        sockI.write(msg)
    })
}

server.on('connection', function(sock) {
    process.stdout.write('CONNECTED: ' + sock.remoteAddress + ':' + sock.remotePort+'\n')
    sock.write( 'WELCOME TO MCORCH\n' )
    sock.write( '$SERVER_READY='+serverReady+"\n" )
    sockets.push(sock)

    sock.on('data', function(data) {
        const dataString = data.toString().trim()
        const commands = dataString.split( /\n/ )
        commands.forEach( (line)=>{
          if( line === '' ) { return }
          let command = ''
          let param = ''
          const spaceIndex = line.indexOf( ' ' )
          if( spaceIndex == -1 ) {
              command = line
          } else {
              command = line.substring(0, spaceIndex )
              param = line.substring(spaceIndex+1).trim()
          }
          switch (command) {
            case 'say':
               sock.write( command) 
               cmdSay( sock.remoteAddress, param )
               break
            case 'stop':
               sock.write( `(cmd stop) ${param}\n` )
               cmdStop( sock.remoteAddress )
               break
            case 'setBlock':
               const p = param.split( /\s+/ );
               if( p.length !== 4 ) {
                   sock.write( 'setBlock needs exactly 4 parameters\n' )
                   sock.write( 'got: ('+p.join(')(')+').\n')
               } else {
                   sock.write( `(cmd setBlock) ${param}\n` )
                   cmdSetBlock( sock.remoteAddress, p )
               }
               break
            default:
               sock.write( `Unknown command ${command}\n` )
          }
       })
        
    })

    // Add a 'close' event handler to this instance of socket
    sock.on('close', function(data) {
        let index = sockets.findIndex(function(o) {
            return o.remoteAddress === sock.remoteAddress && o.remotePort === sock.remotePort
        })
        if (index !== -1) sockets.splice(index, 1)
        process.stdout.write('CLOSED: ' + sock.remoteAddress + ' ' + sock.remotePort+'\n')
    })

})


function cmdSay( addr, parameters ) {
    minecraft.stdin.write( `say ${parameters}\n` )
}

function cmdStop( addr ) {
    minecraft.stdin.write( 'stop\n' )
}
function cmdSetBlock( addr, p ) {
    blocksToSet[`${p[0]} ${p[1]} ${p[2]}`] = p[3];
}
