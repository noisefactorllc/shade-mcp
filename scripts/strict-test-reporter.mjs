export default class StrictTestReporter {
  onTestRunEnd(modules, errors, reason) {
    const tests = modules.flatMap(module => [...module.children.allTests()])
    if (reason !== 'passed' || errors.length || tests.length === 0
      || modules.some(module => module.state() !== 'passed' || ![...module.children.allTests()].length)
      || tests.some(test => test.result().state !== 'passed' || test.options.fails || test.diagnostic().retryCount > 0)) {
      throw new Error('Test summary must report a nonempty suite with no failures, retries, skips or TODOs.')
    }
  }
}
