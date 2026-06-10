import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Toggle from './Toggle';

function ToggleDemo({ label, disabled }: { label?: string; disabled?: boolean }) {
  const [checked, setChecked] = useState(true);
  return <Toggle checked={checked} onChange={setChecked} label={label} disabled={disabled} />;
}

const meta = {
  title: 'UI/Toggle',
  component: Toggle,
  args: { checked: true, onChange: () => {} },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive: Story = { render: () => <ToggleDemo /> };
export const WithLabel: Story = { render: () => <ToggleDemo label="Email notifications" /> };
export const Disabled: Story = { args: { checked: false, disabled: true } };
