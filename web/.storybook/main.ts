import type { StorybookConfig } from '@storybook/nextjs-vite';

const config: StorybookConfig = {
  framework: '@storybook/nextjs-vite',
  stories: ['../components/**/*.stories.tsx', '../app/**/*.stories.tsx'],
};

export default config;
