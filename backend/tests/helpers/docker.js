const Docker = require('dockerode');
const crypto = require('crypto');

const TEST_LABEL = 'gantry.test';
const TEST_LABEL_VALUE = '1';

function makeDocker() {
  return new Docker({ socketPath: '/var/run/docker.sock' });
}

async function pullIfMissing(docker, image) {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch (e) {
    if (e.statusCode !== 404) throw e;
  }
  await new Promise((resolve, reject) => {
    docker.pull(image, (err, stream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

async function createTestContainer(docker, opts = {}) {
  const {
    image = 'alpine',
    cmd = ['sleep', 'infinity'],
    name = `gantry-test-${crypto.randomUUID().slice(0, 8)}`,
    labels = {},
    exposedPorts = {},
    portBindings = {},
    autoStart = true
  } = opts;

  await pullIfMissing(docker, image);

  const container = await docker.createContainer({
    Image: image,
    Cmd: cmd,
    name,
    Labels: { ...labels, [TEST_LABEL]: TEST_LABEL_VALUE },
    ExposedPorts: exposedPorts,
    HostConfig: {
      AutoRemove: false,
      PortBindings: portBindings
    }
  });

  if (autoStart) await container.start();
  return container;
}

async function removeTestContainer(container) {
  if (!container) return;
  try {
    await container.remove({ force: true });
  } catch (e) {
    if (e.statusCode !== 404) throw e;
  }
}

async function cleanupAllTestContainers(docker = makeDocker()) {
  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${TEST_LABEL}=${TEST_LABEL_VALUE}`] })
  });
  await Promise.all(
    containers.map((c) =>
      docker.getContainer(c.Id).remove({ force: true }).catch((e) => {
        if (e.statusCode !== 404) throw e;
      })
    )
  );
}

async function dockerAvailable() {
  try {
    await makeDocker().ping();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  TEST_LABEL,
  TEST_LABEL_VALUE,
  makeDocker,
  pullIfMissing,
  createTestContainer,
  removeTestContainer,
  cleanupAllTestContainers,
  dockerAvailable
};
