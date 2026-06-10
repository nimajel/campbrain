import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import DateRangePicker from './DateRangePicker';

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
