// Every test process starts without external Fetch. Tests may explicitly inject a mock.
globalThis.fetch = async () => {
  throw new Error('EXTERNAL_NETWORK_DISABLED_IN_TESTS');
};
