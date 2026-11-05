import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const root = resolve(`release/${version}`)
async function sha(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
const paths = [
  `AgentHub Setup ${version}.exe`,
  `AgentHub-${version}-portable.exe`,
  `AgentHub-${version}-UserGuide.html`,
  'win-unpacked/AgentHub.exe',
  'win-unpacked/resources/app.asar',
  'win-unpacked/resources/native/agenthub-process-guard.exe',
]
const artifacts = await Promise.all(
  paths.map(async (path) => ({
    path: `release/${version}/${path}`,
    bytes: (await stat(join(root, path))).size,
    sha256: await sha(join(root, path)),
  })),
)
const asar = artifacts.find((a) => a.path.endsWith('app.asar'))!.sha256,
  guard = artifacts.find((a) => a.path.endsWith('agenthub-process-guard.exe'))!.sha256
const reportPaths = {
  team: '.local/packaged-team/report.json',
  images: '.local/live-images/packaged-report.json',
  web: '.local/live-web/packaged-report.json',
  recovery: '.local/live-recovery/packaged-report.json',
  models: '.local/live-models-context/packaged-report.json',
  quota: '.local/live-quota/packaged-report.json',
  automatic: '.local/live-automatic/packaged-report.json',
  agyHost: '.local/live-agy-host/packaged-report.json',
  portable: '.local/portable-acceptance/report.json',
  lifecycle: '.local/live-lifecycle/packaged-report.json',
  coding: '.local/live-release-coding/packaged-report.json',
  upgrade: '.local/installer-roundtrip/upgrade-report.json',
  workflow: '.local/live-workflow/packaged-report.json',
  stream: '.local/live-agy-stream/packaged-report.json',
  soak: '.local/release-soak/packaged-report.json',
}
// Test output is local structured evidence. Read it independently from production IPC types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reports: Record<keyof typeof reportPaths, any> = {} as Record<
  keyof typeof reportPaths,
  unknown
>
for (const [name, path] of Object.entries(reportPaths)) {
  const report = JSON.parse(await readFile(path, 'utf8'))
  if (
    !report.passed ||
    report.version !== version ||
    report.appAsarSha256 !== asar ||
    report.processGuardSha256 !== guard
  )
    throw new Error(`Missing or mismatched exact release evidence: ${name}`)
  reports[name as keyof typeof reportPaths] = report
}
function requireEvidence(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason)
}
const {
  team,
  images,
  web,
  recovery,
  models,
  quota,
  automatic,
  agyHost,
  portable,
  lifecycle,
  coding,
  upgrade,
  workflow,
  stream,
  soak,
} = reports
requireEvidence(
  workflow.threeNativeProviders &&
    workflow.hostCheckpointWithoutGitGrant &&
    workflow.independentWorktrees &&
    workflow.exactSandboxTests &&
    workflow.preservedOriginal &&
    workflow.run.status === 'completed',
  'Native contract workflow evidence missing',
)
requireEvidence(
  stream.publicDeltaBeforeCompletion &&
    stream.deltaCount > 1 &&
    stream.noRawRoutingJson &&
    stream.authoritativeFinalReplacement,
  'Genuine AGY public incremental text evidence missing',
)
requireEvidence(
  soak.initialHistory >= 4000 &&
    soak.notes > 0 &&
    soak.durationMs >= 120000 &&
    soak.p95IpcRoundtripMs < 2000 &&
    soak.historyRestored &&
    soak.noReplay &&
    soak.noModelTurns,
  'Packaged load/persistence evidence missing',
)
requireEvidence(
  ['codex', 'claude', 'antigravity'].every((id) => web.providers[id]?.passed),
  'Native web tool evidence missing',
)
requireEvidence(
  images.packaged &&
    images.independentImageNonces &&
    images.nativeImageSessionResume &&
    new Set(Object.values(images.expectations)).size === 3,
  'Independent native image evidence missing',
)
requireEvidence(
  models.oldChineseSourceRetrieved && models.chatChoicesRestored,
  'Native model/context evidence missing',
)
requireEvidence(
  quota.noModelTurns && quota.foregroundAutoRefresh,
  'Official foreground quota evidence missing',
)
requireEvidence(
  recovery.restartDidNotReplay &&
    recovery.dependencyFollowedRetry &&
    recovery.nativeSessionResumed &&
    recovery.partialFilePreserved,
  'Explicit recovery evidence missing',
)
requireEvidence(
  automatic.blankProject?.renderedHelloWorld &&
    automatic.existingProject?.originalsPreserved &&
    automatic.existingProject?.sensitiveFilesExcluded &&
    automatic.parallelTeam?.separateWorktrees &&
    automatic.parallelTeam?.primaryContainsAllResults &&
    automatic.restart?.unfinishedChangesPreserved &&
    automatic.restart?.noUnfinishedPublication,
  'Automatic coding/integration evidence missing',
)
requireEvidence(
  automatic.parallelTeam.testRuns.filter(
    (t: { execution: string; status: string }) =>
      t.execution === 'native-sandbox' && t.status === 'passed',
  ).length >= 4,
  'Exact native-sandbox test evidence missing',
)
requireEvidence(
  agyHost.hostReads?.initialContextContainsNoProof &&
    agyHost.hostReads.searchThenFullSourceThenImmutableArtifact &&
    agyHost.hostReads.oneNativeSession &&
    agyHost.hostReads.onlyFinalAnswerPublished &&
    agyHost.hostReads.sourceReferencesRecorded &&
    agyHost.hostReads.nativeTurns === 4 &&
    agyHost.cancelledNativeContinuation &&
    agyHost.restartPreservesCountsAndDoesNotReplay,
  'Bounded native AGY host read evidence missing',
)
requireEvidence(
  portable.besideExecutableData &&
    portable.historyRestored &&
    portable.guidePresent &&
    portable.securePreload &&
    portable.launcherSha256 === artifacts.find((a) => a.path.endsWith('-portable.exe'))!.sha256,
  'Actual portable launcher evidence missing',
)
const main = lifecycle.cases?.find((c: { kind: string }) => c.kind === 'main-crash'),
  runtime = lifecycle.cases?.find((c: { kind: string }) => c.kind === 'runtime-crash')
requireEvidence(
  main?.recovered &&
    main.restartDoesNotReplay &&
    main.partialFilePreserved &&
    runtime?.failedVisibly &&
    runtime.otherNativeAgentAnswersOK &&
    runtime.partialFilePreserved &&
    lifecycle.metadataCloseReaped &&
    lifecycle.rendererCrashReaped &&
    lifecycle.restartDoesNotReplay &&
    lifecycle.unrelatedProcessSurvives,
  'Packaged process lifecycle evidence missing',
)
requireEvidence(
  coding.realDelegation &&
    coding.artifactReadByClaude &&
    coding.independentWorktrees &&
    coding.readOnlyReviews &&
    coding.structuredVerdicts,
  'Native delegation/artifact/review evidence missing',
)
requireEvidence(
  coding.reviews?.length === 2 &&
    coding.reviews.every(
      (r: { taskId: string; status: string; verdict: string }) =>
        r.status === 'submitted' &&
        r.verdict === 'approve' &&
        coding.tasks.some(
          (t: { id: string; status: string }) => t.id === r.taskId && t.status === 'completed',
        ),
    ),
  'Final structured reviewer completion evidence missing',
)
requireEvidence(
  coding.testRecords?.length === 2 &&
    coding.testRecords.every(
      (t: { revision: string; status: string; execution: string }, i: number) =>
        t.status === 'passed' &&
        t.execution === 'host-approved' &&
        t.revision === coding.merges[i]?.testedCommit,
    ),
  'Exact reviewed integration test evidence missing',
)
requireEvidence(
  coding.finalProjectTest?.revision === coding.finalRevision &&
    coding.finalProjectTest.execution === 'host-approved generated fixture' &&
    /fail 0/.test(coding.finalProjectTest.stdout),
  'Actual final project test evidence missing',
)
const ownership = JSON.parse(
    (await readFile('.local/installer-roundtrip/ownership.json', 'utf8')).replace(/^\uFEFF/, ''),
  ),
  baseline = JSON.parse(await readFile('.local/installer-roundtrip/baseline-report.json', 'utf8'))
requireEvidence(
  ownership.createdBy === 'AgentHub isolated installer validation' &&
    ownership.phase === 'uninstall' &&
    ownership.to === version &&
    ownership.from === upgrade.from &&
    !existsSync(join(ownership.target, 'AgentHub.exe')),
  'Owned installer uninstall evidence missing',
)
requireEvidence(
  baseline.passed &&
    baseline.installed &&
    baseline.version === ownership.from &&
    baseline.realCodexOK &&
    upgrade.installed &&
    upgrade.historyRestored &&
    upgrade.themeRestored &&
    upgrade.noAutomaticReplay &&
    upgrade.nativeSessionResumed &&
    upgrade.realCodexOK,
  'Real installed upgrade/session evidence missing',
)
requireEvidence(
  ownership.upgradeInstallerSha256 ===
    artifacts.find((a) => a.path.endsWith(`Setup ${version}.exe`))!.sha256,
  'Upgrade installer does not match release',
)
const oldManifest = JSON.parse(
  await readFile(
    existsSync(`release/${ownership.from}/BUILD_MANIFEST.json`)
      ? `release/${ownership.from}/BUILD_MANIFEST.json`
      : `release/${ownership.from}/REVIEW_VALIDATION.json`,
    'utf8',
  ),
)
requireEvidence(
  oldManifest.artifacts.some(
    (a: { path: string; sha256: string }) =>
      a.path.endsWith('app.asar') && a.sha256 === baseline.appAsarSha256,
  ) &&
    oldManifest.artifacts.some(
      (a: { path: string; sha256: string }) =>
        a.path.endsWith('agenthub-process-guard.exe') && a.sha256 === baseline.processGuardSha256,
    ) &&
    oldManifest.artifacts.some(
      (a: { path: string; sha256: string }) =>
        a.path.endsWith(`Setup ${ownership.from}.exe`) &&
        a.sha256 === ownership.baselineInstallerSha256,
    ),
  'Baseline installer/payload provenance missing',
)
const unit = JSON.parse(await readFile('.local/auto-unit-results.json', 'utf8')),
  e2e = JSON.parse(await readFile('.local/auto-e2e-results.json', 'utf8'))
requireEvidence(
  unit.success &&
    !unit.numFailedTests &&
    unit.numPassedTests &&
    e2e.stats.expected &&
    !e2e.stats.unexpected &&
    !e2e.stats.skipped &&
    !e2e.errors.length,
  'Current unit/Electron results missing or failing',
)
const audit = JSON.parse(await readFile('.local/final-validation/audit.json', 'utf8')),
  productionAudit = JSON.parse(
    await readFile('.local/final-validation/audit-production.json', 'utf8'),
  )
requireEvidence(
  audit.metadata?.vulnerabilities?.total === 0 &&
    productionAudit.metadata?.vulnerabilities?.total === 0,
  'Missing or failing dependency audit evidence',
)
const notifications = JSON.parse(
  await readFile('.local/notifications/packaged-notifications-report.json', 'utf8'),
)
requireEvidence(
  notifications.success &&
    notifications.version === version &&
    notifications.appAsarSha256 === asar &&
    notifications.guardSha256 === guard &&
    notifications.nativeToastShown &&
    notifications.nativeOverlayCalled &&
    notifications.realPreflightFailureNotified &&
    notifications.doNotDisturbBlocked &&
    notifications.modelTurns === 0,
  'Native Windows notifications evidence missing',
)
async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((e) =>
      e.isDirectory()
        ? sourceFiles(join(directory, e.name))
        : e.isFile()
          ? [join(directory, e.name)]
          : [],
    ),
  )
  return nested.flat()
}
const inputs = [
  ...(await sourceFiles('src')),
  ...(await sourceFiles('scripts')),
  ...(await sourceFiles('tests')),
  ...(await sourceFiles('assets')),
  '.github/workflows/windows.yml',
  '.github/workflows/release.yml',
  'docs/USER_GUIDE.zh-TW.md',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'electron.vite.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
]
const source = await Promise.all(
  inputs
    .sort()
    .map(async (path) => ({ path: path.replaceAll('\\', '/'), sha256: await sha(path) })),
)
const manifest = {
  version,
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  unsigned: true,
  artifacts,
  sourceDigest: createHash('sha256').update(JSON.stringify(source)).digest('hex'),
  sourceFiles: source,
  validation: {
    unitTests: unit.numPassedTests,
    electronE2E: e2e.stats.expected,
    audit: { allAdvisories: 0, productionAdvisories: 0 },
    packagedReports: Object.keys(reportPaths).length,
    appAsarSha256: asar,
    nativeGuardSha256: guard,
    reportHashes: await Promise.all(
      Object.entries(reportPaths).map(async ([name, path]) => ({ name, sha256: await sha(path) })),
    ),
    nativeCoding: {
      passed: true,
      realDelegation: true,
      immutableArtifactReadByClaude: true,
      reviews: coding.reviews.map(
        (r: { reviewerId: string; revision: string; verdict: string }) => ({
          reviewer: r.reviewerId,
          revision: r.revision,
          verdict: r.verdict,
        }),
      ),
      testRecords: coding.testRecords.map(
        (t: { revision: string; status: string; execution: string }) => ({
          revision: t.revision,
          status: t.status,
          execution: t.execution,
        }),
      ),
      finalRevision: coding.finalRevision,
      finalProjectTestExecution: coding.finalProjectTest.execution,
    },
    installedUpgrade: {
      passed: true,
      from: ownership.from,
      to: version,
      realCodexOKBeforeAndAfter: true,
      nativeSessionResumed: true,
      historyAndThemeRestored: true,
      noAutomaticReplay: true,
      uninstalledTestCopy: true,
      baselineInstallerSha256: ownership.baselineInstallerSha256,
      upgradeInstallerSha256: ownership.upgradeInstallerSha256,
    },
    processLifecycle: {
      passed: true,
      mainCrash: true,
      runtimeCrash: true,
      rendererCrash: true,
      metadataClose: true,
      unrelatedProcessPreserved: true,
    },
    portable: { passed: true, launcherSha256: portable.launcherSha256 },
    automaticProjects: {
      passed: true,
      independentWorktrees: true,
      nativeSandboxTests: automatic.parallelTeam.testRuns,
    },
    modelsAndContext: {
      passed: true,
      turns: models.turns.map((turn: { provider: string; runtime: unknown }) => ({
        provider: turn.provider,
        runtime: turn.runtime,
      })),
    },
    officialQuota: {
      passed: true,
      noModelTurns: true,
      foregroundAutoRefresh: true,
      available: quota.quotas
        .filter((q: { status: string }) => q.status === 'available')
        .map((q: { provider: string }) => q.provider),
      unavailable: quota.quotas
        .filter((q: { status: string }) => q.status === 'unavailable')
        .map((q: { provider: string }) => q.provider),
    },
    nativeImages: { passed: true, independentImageNonces: true },
    nativeNotifications: {
      passed: true,
      noModelTurns: true,
      osClickAutomated: false,
      reportSha256: await sha('.local/notifications/packaged-notifications-report.json'),
    },
    nativeWeb: { passed: true, providers: Object.keys(web.providers) },
    explicitRecovery: { passed: true, nativeSessionResumed: true },
    agyHostReads: { passed: true, nativeTurns: 4 },
    threeNativeOK: !!team.passed,
    contractWorkflow: { passed: true, threeNativeProviders: true, exactSandboxTests: true },
    agyIncrementalText: { passed: true, deltaCount: stream.deltaCount },
    load: {
      passed: true,
      initialHistory: soak.initialHistory,
      notes: soak.notes,
      durationMs: soak.durationMs,
      p95IpcRoundtripMs: soak.p95IpcRoundtripMs,
    },
  },
  limitations: [
    'Unsigned installers; no automatic updater',
    'Clean Windows Server CI is separate evidence; no clean Windows 10/11 client or external security audit',
    'Claude subscription CLI is live-tested; SDK/API-key mode has contract tests only',
    'Windows Job ownership is not filesystem/network isolation; Claude Shell isolation matrix incomplete',
    'AGY quota requires official zero-turn usage metadata from CLI 1.5.1+',
    'Manual reviewed-coding fixture tests are host-approved; automatic-project tests use native sandbox',
    'User explicitly retained review item 2 automatic approval policy',
  ],
  evidenceNote:
    'All fifteen packaged reports belong to this exact local application/guard. CI-built release binaries have separate offline/Electron/NSIS evidence. Baseline upgrade provenance is checked against its retained receipt. Private evidence is local, separate from public source.',
}
await writeFile('docs/BUILD_MANIFEST.json', JSON.stringify(manifest, null, 2) + '\n')
await writeFile(join(root, 'BUILD_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n')
await writeFile(
  join(root, 'SHA256SUMS.txt'),
  artifacts
    .map((a) => `${a.sha256}  ${relative(root, resolve(a.path)).replaceAll('\\', '/')}`)
    .join('\n') + '\n',
)
console.log(
  JSON.stringify(
    {
      version,
      artifacts,
      unitTests: unit.numPassedTests,
      electronE2E: e2e.stats.expected,
      packagedReports: Object.keys(reportPaths).length,
    },
    null,
    2,
  ),
)
