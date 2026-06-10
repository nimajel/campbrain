import type { Preview } from '@storybook/nextjs-vite';
import React from 'react';
import { Inter, Fraunces } from 'next/font/google';
import '../app/globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const fraunces = Fraunces({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--font-fraunces', display: 'swap' });

const preview: Preview = {
  parameters: {
    backgrounds: {
      options: {
        app: { name: 'App body', value: '#fbfaf6' },
        page: { name: 'Page sand', value: '#ece5d6' },
      },
    },
  },
  initialGlobals: {
    backgrounds: { value: 'app' },
  },
  decorators: [
    (Story) => (
      <div
        className={`${inter.variable} ${fraunces.variable}`}
        style={{ fontFamily: 'var(--font)', fontSize: 14, lineHeight: 1.6, color: 'var(--text)', padding: 16 }}
      >
        <Story />
      </div>
    ),
  ],
  tags: ['autodocs'],
};

export default preview;
