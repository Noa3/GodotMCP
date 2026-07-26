import type { McpRuntimeContext } from '../context';

export interface PromptDefinition {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required?: boolean }>;
  build: (args: Record<string, string>) => { description: string; messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }> };
}

function buildProjectAwarePrompt(context: McpRuntimeContext, title: string, task: string): string {
  return `${title}\nProject root: ${context.projectRoot}\nTask: ${task}\nUse the Godot project tools, file tools, scene tools, and script tools to inspect the project and produce a concrete actionable result.`;
}

export function buildPromptDefinitions(context: McpRuntimeContext): PromptDefinition[] {
  return [
    {
      name: 'godot_project_audit',
      description: 'Audit the Godot project structure, scripts and scenes.',
      arguments: [{ name: 'focus', description: 'Optional focus area such as performance, architecture or content pipeline.' }],
      build: (args) => ({
        description: 'Audit the Godot project.',
        messages: [{ role: 'user', content: { type: 'text', text: buildProjectAwarePrompt(context, 'Godot Project Audit', `Audit the project${args.focus ? ` with focus on ${args.focus}` : ''}.`) } }],
      }),
    },
    {
      name: 'godot_scene_review',
      description: 'Review a scene for hierarchy issues and broken references.',
      arguments: [{ name: 'scenePath', description: 'Project-relative path to the scene.', required: true }],
      build: (args) => ({
        description: 'Review a Godot scene.',
        messages: [{ role: 'user', content: { type: 'text', text: buildProjectAwarePrompt(context, 'Godot Scene Review', `Review scene ${args.scenePath}. Validate structure, broken references and likely maintenance risks.`) } }],
      }),
    },
    {
      name: 'godot_bugfix_plan',
      description: 'Generate a bugfix plan for a Godot issue.',
      arguments: [{ name: 'bug', description: 'Bug summary.', required: true }],
      build: (args) => ({
        description: 'Create a bugfix plan.',
        messages: [{ role: 'user', content: { type: 'text', text: buildProjectAwarePrompt(context, 'Godot Bugfix Plan', `Create a bugfix plan for: ${args.bug}`) } }],
      }),
    },
    {
      name: 'godot_add_feature',
      description: 'Plan how to add a new feature to a Godot project.',
      arguments: [{ name: 'feature', description: 'Feature summary.', required: true }],
      build: (args) => ({
        description: 'Plan a feature implementation.',
        messages: [{ role: 'user', content: { type: 'text', text: buildProjectAwarePrompt(context, 'Godot Add Feature', `Plan the implementation for feature: ${args.feature}`) } }],
      }),
    },
    {
      name: 'godot_performance_pass',
      description: 'Analyze likely performance bottlenecks in the project.',
      arguments: [{ name: 'target', description: 'Optional area such as scenes, scripts or runtime.' }],
      build: (args) => ({
        description: 'Create a performance pass plan.',
        messages: [{ role: 'user', content: { type: 'text', text: buildProjectAwarePrompt(context, 'Godot Performance Pass', `Perform a performance review${args.target ? ` for ${args.target}` : ''}.`) } }],
      }),
    },
    {
      name: 'godot_export_release_checklist',
      description: 'Prepare a release/export checklist for a Godot build.',
      arguments: [{ name: 'platform', description: 'Optional export target platform.' }],
      build: (args) => ({
        description: 'Generate an export checklist.',
        messages: [{ role: 'user', content: { type: 'text', text: buildProjectAwarePrompt(context, 'Godot Export Release Checklist', `Prepare an export checklist${args.platform ? ` for ${args.platform}` : ''}.`) } }],
      }),
    },
  ];
}
