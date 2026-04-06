const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const conn = new Client();
const REMOTE_DIR = '/home/u802021756/domains/mediumblue-butterfly-391367.hostingersite.com/public_html';
const LOCAL_DIR = path.join(__dirname, 'dist');

function getSftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
  });
}

function uploadFile(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(localPath);
    const writeStream = sftp.createWriteStream(remotePath);
    writeStream.on('close', () => resolve());
    writeStream.on('error', reject);
    readStream.pipe(writeStream);
  });
}

function mkdirRemote(sftp, dirPath) {
  return new Promise((resolve) => {
    sftp.mkdir(dirPath, (err) => resolve()); // ignore if exists
  });
}

async function uploadDir(sftp, localDir, remoteDir) {
  await mkdirRemote(sftp, remoteDir);
  const entries = fs.readdirSync(localDir, { withFileTypes: true });

  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);
    const remotePath = `${remoteDir}/${entry.name}`;

    if (entry.isDirectory()) {
      await uploadDir(sftp, localPath, remotePath);
    } else {
      console.log(`  ${entry.name}`);
      await uploadFile(sftp, localPath, remotePath);
    }
  }
}

conn.on('ready', async () => {
  try {
    const sftp = await getSftp(conn);
    console.log(`Deploying to ${REMOTE_DIR}...`);
    await uploadDir(sftp, LOCAL_DIR, REMOTE_DIR);
    console.log('\nDeploy complete!');
  } catch (err) {
    console.error('Deploy error:', err.message);
  }
  conn.end();
});

conn.on('error', (err) => console.error('SSH error:', err.message));
conn.connect({ host: '46.202.172.145', port: 65002, username: 'u802021756', password: '3Rx.q#U8Msz8vuv' });
