// Plugin system commands (Phase 5).

import { registry as pluginRegistry } from '../../sdk/core.mjs';

export async function cmdPlugins(opts) {
  if (opts.list || opts._ === 'list') {
    console.log('📦 ForecastLab Plugins\n');

    const stats = pluginRegistry.getStats();
    console.log(`Registered: ${stats.models} models, ${stats.metrics} metrics, ${stats.commands} commands`);
    console.log('');

    const models = pluginRegistry.listModelsMetadata();
    if (models.length > 0) {
      console.log('Available Models:');
      console.log('─────────────');
      for (const model of models) {
        console.log(`  • ${model.id}`);
        if (model.description) console.log(`    ${model.description}`);
      }
    } else {
      console.log('No custom plugins loaded.');
      console.log('Use: forecastlab install-plugin <plugin-name>');
    }
  } else if (opts.install || opts._ === 'install') {
    console.log('Plugin installation coming soon...');
  }
}

export async function cmdInstallPlugin(opts) {
  if (!opts.plugin && !opts.name) {
    throw new Error('Usage: forecastlab install-plugin <name> [--from-url]');
  }

  const pluginName = opts.plugin || opts.name;
  console.log(`📥 Installing plugin: ${pluginName}`);
  console.log('Installation API under development...');
}
