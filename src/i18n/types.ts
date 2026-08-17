/**
 * i18n Type Definitions
 * Provides full type safety and IDE autocompletion for translations
 */

export type SupportedLocale = 'zh-CN' | 'en-US';
export type LanguageSetting = 'system' | SupportedLocale;

/**
 * Translation dictionary interface
 * Organized by component/feature for maintainability
 */
export interface TranslationDict {
  // Common/Shared
  common: {
    appName: string;
    appSlogan: string;
    windowTitle: string;
    version: string;
    close: string;
    cancel: string;
    confirm: string;
    save: string;
    delete: string;
    search: string;
    loading: string;
    comingSoon: string;
  };

  // Sidebar
  sidebar: {
    newTask: string;
    searchConversations: string;
    searchPlaceholder: string;
    noSearchResults: string;
    searchChats: string;
    recommended: string;
    scheduledTasks: string;
    toolbox: string;
    recents: string;
    projects: string;
    conversations: string;
    expandProjectConversations: string;
    collapseProject: string;
    projectMore: string;
    newProjectConversation: string;
    openProjectLocation: string;
    renameProject: string;
    removeProject: string;
    removeProjectTitle: string;
    removeProjectDesc: string;
    noSessionsYet: string;
    hideSidebar: string;
    showSidebar: string;
    goBack: string;
    goForward: string;
    scheduled: string;
    noScheduledRuns: string;
    exportConversation: string;
    archiveConversation: string;
    conversationArchived: string;
    renameConversation: string;
    viewScheduledTask: string;
    archiveRun: string;
    help: string;
    editProfile: string;
    nickname: string;
    nicknamePlaceholder: string;
    avatar: string;
    changeAvatar: string;
    defaultNickname: string;
    resetProfile: string;
    login: string;
    loggedInAs: string;
    account: string;
    currentAccount: string;
    accountSignedIn: string;
    enterCredentials: string;
    username: string;
    password: string;
    signOut: string;
    signingIn: string;
  };

  // Chat/Welcome
  chat: {
    inputPlaceholder: string;
    inputPlaceholderBusy: string;
    inputPlaceholderWithSkill: string;
    inputPlaceholderWithAgent: string;
    inputPlaceholderMidTask: string;
    appLoading: string;
    gatewayStarting: string;
    mcpWarming: string;
    mcpUnavailable: string;
    start: string;
    send: string;
    stop: string;
    stopping: string;
    welcomeTitle: string;
    welcomeSubtitle: string;
    thinking: string;
    dropFilesHere: string;
    pasteOrDropImages: string;
    imageAdded: string;
    removeImage: string;
    openInFinder: string;
    clickToPreview: string;
    sources: string;
    showAllSources: string;
    collapseSources: string;
    scrollToBottom: string;
    openTerminal: string;
    searchConversation: string;
    searchConversationPlaceholder: string;
    previousSearchMatch: string;
    nextSearchMatch: string;
    closeConversationSearch: string;
    loadingConversation: string;
    conversationLoadFailed: string;
    conversationLoadFailedDesc: string;
    codeBlockExpand: string;
    codeBlockCollapse: string;
    codeBlockSaveAs: string;
    setupRequired: string;
    setupRequiredDesc: string;
    setupButton: string;
    // MessageBubble
    thinkingProcess: string;
    copy: string;
    edit: string;
    regenerate: string;
    saveAndResend: string;
    clickToViewFull: string;
    inputTokens: string;
    outputTokens: string;
    addAttachment: string;
    shortcutDataAnalysis: string;
    shortcutOffice: string;
  };

  // Status Bar
  status: {
    ready: string;
    thinking: string;
    responding: string;
    usingTool: string;
  };

  // Task Block
  task: {
    processing: string;
    completed: string;
    createdFile: string;
    createdFiles: string;
    modifiedFile: string;
    modifiedFiles: string;
    readFile: string;
    readFiles: string;
    executedCommand: string;
    executedCommands: string;
    calledTool: string;
    calledTools: string;
    executedOperations: string;
    thoughtFor: string;
    executedIn: string;
    result: string;
    retryAction: string;
    errorOccurred: string;
    delegatedTo: string;
    agentProcessing: string;
    // Step type labels
    typeRead: string;
    typeWrite: string;
    typeCreate: string;
    typeScript: string;
    typeSkill: string;
    typeDelegate: string;
    typeTool: string;
    typeSearch: string;
    input: string;
    output: string;
    done: string;
    running: string;
    showMore: string;
    collapse: string;
  };

  // Settings Modal
  settings: {
    title: string;
    apiConfig: string;
    modelSelect: string;
    advanced: string;
    pressEscToClose: string;
    // API Section
    provider: string;
    providerAnthropic: string;
    providerOpenAI: string;
    providerLocal: string;
    apiProtocol: string;
    openaiCompatible: string;
    anthropicNative: string;
    openaiCompatibleDesc: string;
    anthropicNativeDesc: string;
    apiUrl: string;
    apiUrlHint: string;
    apiUrlDesc: string;
    apiKey: string;
    apiKeyPlaceholder: string;
    apiKeyDesc: string;
    // Model Section
    model: string;
    customModelOption: string;
    customModelName: string;
    customModelPlaceholder: string;
    customModelDesc: string;
    currentModel: string;
    notSet: string;
    // Advanced Section
    baseUrl: string;
    baseUrlPlaceholder: string;
    apiFormat: string;
    selectModel: string;
    customModel: string;
    temperature: string;
    temperaturePrecise: string;
    temperatureCreative: string;
    temperatureDescription: string;
    extendedThinking: string;
    extendedThinkingDescription: string;
    thinkingBudget: string;
    thinkingBudgetFast: string;
    thinkingBudgetDeep: string;
    // Language
    language: string;
    languageDescription: string;
    followSystem: string;
    // Image Generation
    imageGen: string;
    imageGenDescription: string;
    imageGenApiKey: string;
    imageGenApiKeyPlaceholder: string;
    imageGenApiKeyDesc: string;
    imageGenBaseUrl: string;
    imageGenBaseUrlPlaceholder: string;
    imageGenBaseUrlDesc: string;
    imageGenModel: string;
    imageGenCustomModel: string;
    // Web Search
    webSearch: string;
    webSearchDescription: string;
    webSearchProvider: string;
    webSearchApiKey: string;
    webSearchApiKeyPlaceholder: string;
    webSearchApiKeyDesc: string;
    webSearchBaseUrl: string;
    webSearchBaseUrlPlaceholder: string;
    webSearchBaseUrlDesc: string;
    webSearchProviderBing: string;
    webSearchProviderBrave: string;
    webSearchProviderTavily: string;
    webSearchProviderSearXNG: string;
    // AI Services
    aiServices: string;
    aiServicesDescription: string;
    capabilities: string;
    capabilityChat: string;
    capabilityWebSearch: string;
    capabilityImageGen: string;
    builtinSupported: string;
    builtinNotSupported: string;
    useBuiltinSearch: string;
    useBuiltinSearchDesc: string;
    configCustomSearch: string;
    configCustomImageGen: string;
    // Sandbox
    sandbox: string;
    sandboxDescription: string;
    sandboxEnabled: string;
    sandboxDisabled: string;
    sandboxProtection: string;
    sandboxProtectionDescription: string;
    sandboxMacOSOnly: string;
    sandboxAppLayerProtection: string;
    sandboxProtectedPaths: string;
    sandboxWritablePaths: string;
    sandboxDisableWarning: string;
    // Network isolation
    networkIsolation: string;
    networkIsolationDescription: string;
    allowPrivateNetworks: string;
    networkWhitelist: string;
    networkPreset: string;
    networkCustom: string;
    // General section
    general: string;
    generalDescription: string;
    closeWindowBehavior: string;
    closeWindowAsk: string;
    closeWindowAskDesc: string;
    closeWindowMinimize: string;
    closeWindowMinimizeDesc: string;
    closeWindowQuit: string;
    closeWindowQuitDesc: string;
    // Behavior sensor
    behaviorSensor: string;
    behaviorSensorDesc: string;
    behaviorSensorClearData: string;
    behaviorSensorCleared: string;
    behaviorSensorPermissionDenied: string;
    behaviorSensorPermissionGuide: string;
    computerUse: string;
    computerUseDesc: string;
    computerUsePermissionDenied: string;
    computerUsePermissionGuide: string;
    // ModelConfigSection
    currentConfig: string;
    configured: string;
    notConfigured: string;
    selectProvider: string;
    selectPlaceholder: string;
    autoSaved: string;
    // Embedding Settings
    embedding: {
      title: string;
      provider: string;
      model: string;
      dimensions: string;
      apiKey: string;
      baseUrl: string;
      localMode: string;
      dimensionsDesc: string;
      setupDesc: string;
      status: string;
      localStatus: string;
      remoteAPI: string;
      running: string;
      initializing: string;
      stopped: string;
      database: string;
      totalRecords: string;
      deleteConfirm: string;
      noRecords: string;
    };
  };

  // Toolbox Modal
  toolbox: {
    title: string;
    expertTeams: string;
    skills: string;
    manageSkills: string;
    searchMySkills: string;
    noMySkills: string;
    mcp: string;
    searchPlaceholder: string;
    footerDescription: string;
    // Skills Section
    installedSkills: string;
    noInstalledSkills: string;
    skillMarketplace: string;
    createSkill: string;
    createWithAbu: string;
    createManually: string;
    nameFormatHint: string;
    aiAssistedCreate: string;
    installFailed: string;
    // MCP Section
    mcpServers: string;
    configuredServers: string;
    addServer: string;
    addCustomServer: string;
    noServersConfigured: string;
    noServersConnected: string;
    serverName: string;
    serverCommand: string;
    serverArgs: string;
    transportType: string;
    transportStdio: string;
    transportHttp: string;
    serverUrl: string;
    serverUrlPlaceholder: string;
    serverHeaders: string;
    serverHeadersPlaceholder: string;
    serverTimeout: string;
    connected: string;
    connecting: string;
    reconnecting: string;
    disconnected: string;
    connect: string;
    disconnect: string;
    add: string;
    install: string;
    installed: string;
    installAndConnect: string;
    popularMCPServices: string;
    setupWithAbu: string;
    aiAssistedMCPSetup: string;
    // Source labels
    sourceBuiltin: string;
    sourceProject: string;
    sourceUser: string;
    sourceUnknown: string;
    builtinSkills: string;
    builtinAgents: string;
    noSkillsFound: string;
    noAgentsFound: string;
    systemSkills: string;
    customSkills: string;
    noCustomSkills: string;
    // Customize Panel
    customize: string;
    customizeFooter: string;
    models: string;
    // ModelsSection
    currentConfig: string;
    quickSwitch: string;
    current: string;
    configured: string;
    notConfigured: string;
    localModels: string;
    openaiCompatible: string;
    qiniuCloud: string;
    deepseek: string;
    anthropic: string;
    volcengine: string;
    bailian: string;
    advancedSettings: string;
    advancedSettingsDesc: string;
    // Sub-tab labels
    tabSystem: string;
    tabCustom: string;
    tabConnected: string;
    tabConfigured: string;
    tabRecommended: string;
    createMCP: string;
    uploadFile: string;
    manualAdd: string;
    // Skill detail & editor
    skillDetail: string;
    skillTrigger: string;
    skillDoNotTrigger: string;
    skillTags: string;
    skillAllowedTools: string;
    skillContext: string;
    skillContextInline: string;
    skillContextFork: string;
    skillMaxTurns: string;
    skillContent: string;
    skillEnabled: string;
    skillDisabled: string;
    skillEdit: string;
    skillSave: string;
    skillSaveAndTest: string;
    skillEditorTitle: string;
    skillEditorName: string;
    skillEditorDescription: string;
    skillEditorMetadata: string;
    skillEditorContent: string;
    skillEditorPreview: string;
    skillArgumentHint: string;
    skillUserInvocable: string;
    activeSkills: string;
    activeSkillsRemove: string;
    // Category filter
    categoryAll: string;
    categoryDocument: string;
    categoryDesign: string;
    categoryDevelopment: string;
    // Agent detail & editor
    agentDetail: string;
    agentModel: string;
    agentModelInherit: string;
    agentTools: string;
    agentDisallowedTools: string;
    agentSkills: string;
    agentMemory: string;
    agentMemorySession: string;
    agentMemoryProject: string;
    agentMemoryUser: string;
    agentMaxTurns: string;
    agentBackground: string;
    agentAvatar: string;
    agentSystemPrompt: string;
    agentEdit: string;
    agentSave: string;
    agentSaveAndTest: string;
    agentEditorTitle: string;
    agentEditorName: string;
    agentEditorDescription: string;
    agentEditorMetadata: string;
    agentEditorContent: string;
    agentEditorPreview: string;
    agentEnabled: string;
    agentDisabled: string;
    agentCategoryAll: string;
    agentCategoryResearch: string;
    agentCategoryDevelopment: string;
    agentCategoryWriting: string;
    noCustomAgents: string;
    // Connection test
    testConnection: string;
    testSuccess: string;
    testFailed: string;
    testing: string;
    // Tool count
    toolCount: string;
    noTools: string;
    // Server logs
    viewLogs: string;
    noLogs: string;
    // Marketplace/catalog card i18n
    installing: string;
    aiCreateSkillPrompt: string;
  };

  // Permission Dialog
  permission: {
    workspace: {
      title: string;
      description: string;
      capabilities: string[];
      warning: string;
    };
    shell: {
      title: string;
      description: string;
      capabilities: string[];
      warning: string;
    };
    fileWrite: {
      title: string;
      description: string;
      capabilities: string[];
      warning: string;
    };
    fileRead?: {
      title: string;
      description: string;
      capabilities: string[];
      warning: string;
    };
    folderSelect?: {
      title: string;
      description: string;
      selectButton: string;
      hint: string;
    };
    ruyiCanDo: string;
    allowOnce: string;
    allowAlways: string;
    deny: string;
    rememberChoice: string;
    rememberChoiceDescription: string;
    forgetAfterSession: string;
    // Duration options
    durationOnce: string;
    durationSession: string;
    duration24h: string;
    durationAlways: string;
    durationAlwaysConfirm: string;
    // Button labels per duration
    durationLabel: string;
    allowOnceButton: string;
    allowSessionButton: string;
    allow24hButton: string;
    allowAlwaysButton: string;
  };

  // Panels
  panel: {
    workspace: string;
    files: string;
    preview: string;
    noWorkspaceSelected: string;
    selectWorkspace: string;
    noFilesModified: string;
    selectWorkspaceHint: string;
    recentlyUsed: string;
    selectOtherFolder: string;
    instructionFile: string;
    openInFinder: string;
    closePreview: string;
    previewMode: string;
    sourceMode: string;
    unsupportedFileType: string;
    showInFinder: string;
    openInSystem: string;
    openInBrowser: string;
    revealInFolder: string;
    downloadFile: string;
    failedToReadFile: string;
    fileNotFound: string;
    // FilesSection
    operationRead: string;
    operationModify: string;
    operationCreate: string;
    clickToPreview: string;
    showInFinderButton: string;
    noReferencedFiles: string;
    filesCount: string;
    addFile: string;
    // RightPanel
    details: string;
    hidePanel: string;
    showPanel: string;
    // TaskProgressPanel
    progress: string;
    progressEmptyHint: string;
    progressPlanning: string;
    progressRunning: string;
    workbench: string;
    pinnedSummary: string;
    artifacts: string;
    artifactsEmptyHint: string;
    artifactsLoadFailed: string;
    artifactsRetry: string;
    artifactsRefresh: string;
    artifactsOpenFolder: string;
    browserTitle: string;
    browserShow: string;
    browserClose: string;
    browserPause: string;
    browserResume: string;
    browserStop: string;
    browserRefresh: string;
    browserOpenExternal: string;
    browserWaiting: string;
    browserUserControlHint: string;
    browserActions: string;
    // ContextSection
    context: string;
    contextEmptyHint: string;
    accessedFiles: string;
    toolUsage: string;
    moreFiles: string;
    collapse: string;
    connectors: string;
    refreshing: string;
    // Preview: PDF
    pdfPage: string;
    pdfZoomIn: string;
    pdfZoomOut: string;
    pdfPrevPage: string;
    pdfNextPage: string;
    // Preview: XLSX
    xlsxSheetLabel: string;
    xlsxRowsShowing: string;
    // Preview: CSV
    csvNoData: string;
    // Preview: common
    loadingDocument: string;
  };

  // Folder Selector
  folder: {
    selectFolder: string;
    selectWorkspaceFolder: string;
    recentFolders: string;
    browse: string;
    clearWorkspace: string;
    loadFolder: string;
    selectOtherFolder: string;
    chooseProject: string;
    newProject: string;
    searchProject: string;
    noProjectsFound: string;
    createBlankProject: string;
    useExistingFolder: string;
    dontUseProject: string;
    selectNewProjectLocation: string;
    enterNewProjectName: string;
    nameProject: string;
    nameProjectHint: string;
    defaultProjectName: string;
  };

  // Scheduled Tasks
  schedule: {
    title: string;
    newTask: string;
    editTask: string;
    taskName: string;
    taskNamePlaceholder: string;
    taskPrompt: string;
    taskPromptPlaceholder: string;
    frequency: string;
    frequencyHourly: string;
    frequencyDaily: string;
    frequencyWeekly: string;
    frequencyMonthly: string;
    frequencyWeekdays: string;
    frequencyManual: string;
    executionTime: string;
    minuteOfHour: string;
    dayOfWeek: string;
    dayOfMonth: string;
    monthDay: string;
    monthDayHint: string;
    sunday: string;
    monday: string;
    tuesday: string;
    wednesday: string;
    thursday: string;
    friday: string;
    saturday: string;
    bindSkill: string;
    bindSkillNone: string;
    workspacePath: string;
    workspacePathPlaceholder: string;
    statusActive: string;
    statusPaused: string;
    runNow: string;
    pause: string;
    resume: string;
    edit: string;
    delete: string;
    deleteConfirm: string;
    deleteRun: string;
    deleteRunConfirm: string;
    deleteRunFailed: string;
    lastRun: string;
    nextRun: string;
    never: string;
    noTasks: string;
    noTasksHint: string;
    noTasksCTA: string;
    runHistory: string;
    noRuns: string;
    runStatusRunning: string;
    runStatusCompleted: string;
    runStatusError: string;
    viewConversation: string;
    ago: string;
    running: string;
    activeCount: string;
    skippedDangerousOp: string;
    // v2 additions
    description: string;
    descriptionPlaceholder: string;
    backToList: string;
    taskDetail: string;
    prompt: string;
    schedule: string;
    status: string;
    totalRuns: string;
    taskCompleted: string;
    taskError: string;
    onlyRunWhileAwake: string;
    unreadRuns: string;
    askRuyiToCreate: string;
    askAbuCreatePrompt: string;
    tasksTab: string;
    addAutomation: string;
    loadingTasks: string;
    retry: string;
    startFirstAutomation: string;
    startFirstAutomationHint: string;
    myAutomations: string;
    automationSummary: string;
    templateTitle: string;
    templateHint: string;
    templateCount: string;
    useTemplate: string;
    runCount: string;
    filterAll: string;
    filterUnread: string;
    searchRuns: string;
    clearSearch: string;
    noRunsHint: string;
    noMatchingRuns: string;
    clearFilters: string;
    today: string;
    yesterday: string;
    runCompletedSummary: string;
  };

  // Updates
  updates: {
    newVersionAvailable: string;
    currentVersion: string;
    latestVersion: string;
    checkForUpdates: string;
    checking: string;
    upToDate: string;
    downloadUpdate: string;
    releaseNotes: string;
    checkFailed: string;
  };

  // About

  // Quick Start Guide
  guide: {
    title: string;
    step1Title: string;
    step1Desc: string;
    step2Title: string;
    step2Desc: string;
    step3Title: string;
    step3Desc: string;
    dismiss: string;
  };

  onboarding: {
    stepIndicator: string;
    title: string;
    subtitle: string;
    languageLabel: string;
    languageSystem: string;
    languageHint: string;
    appearanceLabel: string;
    themeSystem: string;
    themeSystemDescription: string;
    themeLight: string;
    themeLightDescription: string;
    themeDark: string;
    themeDarkDescription: string;
    next: string;
    back: string;
    start: string;
    profileTitle: string;
    profileHint: string;
    name: string;
    namePlaceholder: string;
    timezone: string;
    timezoneSystem: string;
    preferredLanguage: string;
    communicationStyle: string;
    communicationCasual: string;
    communicationProfessional: string;
    communicationTechnical: string;
    responseLength: string;
    responseBrief: string;
    responseDetailed: string;
    responseAdaptive: string;
    technicalLevel: string;
    levelBeginner: string;
    levelIntermediate: string;
    levelExpert: string;
    language: string;
  };

  // Command Confirmation Dialog
  commandConfirm: {
    title: string;
    titleDanger: string;
    titleBlock: string;
    description: string;
    descriptionDanger: string;
    descriptionBlock: string;
    cancel: string;
    confirm: string;
    blocked: string;
    userCancelled: string;
  };

    // Tool error messages
  toolErrors: {
    userDeniedAccess: string;
    pathAccessDenied: string;
    needsAuthorization: string;
  };
}
