const {
  makeDocker,
  createTestContainer,
  removeTestContainer,
  cleanupAllTestContainers,
  dockerAvailable
} = require('../helpers/docker');
const { pickShell } = require('../../src/exec-shell');

const docker = makeDocker();
let dockerReady;

beforeAll(async () => {
  dockerReady = await dockerAvailable();
  if (!dockerReady) return;
  await cleanupAllTestContainers(docker);
});

afterAll(async () => {
  if (dockerReady) await cleanupAllTestContainers(docker);
});

describe.skipIf(!process.env.RUN_DOCKER_TESTS && process.env.CI)('pickShell against real containers', () => {
  let container;

  afterEach(async () => {
    await removeTestContainer(container);
    container = undefined;
  });

  it('returns /bin/sh for alpine (has sh + ash, no bash)', async () => {
    if (!dockerReady) return;
    container = await createTestContainer(docker, { image: 'alpine' });
    const shell = await pickShell(container);
    expect(shell).toBe('/bin/sh');
  });

  it('returns null when no candidate shell exists', async () => {
    if (!dockerReady) return;
    container = await createTestContainer(docker, { image: 'alpine' });
    const shell = await pickShell(container, ['/no/such/shell', '/also/missing']);
    expect(shell).toBeNull();
  });
});
