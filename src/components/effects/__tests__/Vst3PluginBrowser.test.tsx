/**
 * Re-export of PluginBrowser tests under the old test file path.
 *
 * Vst3PluginBrowser was replaced by PluginBrowser in Sprint 24.
 * All tests have moved to PluginBrowser.test.tsx; this file redirects
 * so any legacy CI references continue to find a valid test file.
 */

export * from './PluginBrowser.test';
