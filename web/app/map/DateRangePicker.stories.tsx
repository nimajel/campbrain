import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import DateRangePicker from './DateRangePicker';

function isoFromToday(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function PrefilledDemo() {
  const [range, setRange] = useState({ from: isoFromToday(7), to: isoFromToday(9) });
  return (
    <DateRangePicker
      from={range.from}
      to={range.to}
      onChange={(from, to) => setRange({ from, to })}
    />
  );
}

function PickerDemo({ mobile }: { mobile?: boolean }) {
  const [range, setRange] = useState({ from: '', to: '' });
  return (
    <DateRangePicker
      from={range.from}
      to={range.to}
      mobile={mobile}
      onChange={(from, to) => setRange({ from, to })}
    />
  );
}

const meta = {
  title: 'Components/DateRangePicker',
  component: DateRangePicker,
  args: { from: '', to: '', onChange: () => {} },
} satisfies Meta<typeof DateRangePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = { render: () => <PickerDemo /> };
export const MobileInline: Story = { render: () => <PickerDemo mobile /> };
export const WithPrefilledRange: Story = { render: () => <PrefilledDemo /> };
