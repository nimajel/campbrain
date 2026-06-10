import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import SiteChip from './SiteChip';

const meta = {
  title: 'UI/SiteChip',
  component: SiteChip,
  args: { children: 'Site 4' },
} satisfies Meta<typeof SiteChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Muted: Story = { args: { children: 'Site 12 (walk-up)', style: { opacity: 0.75 } } };
export const More: Story = { args: { more: true, onClick: () => {}, children: '+8 more' } };
export const ChipRow: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      <SiteChip>Site 4</SiteChip>
      <SiteChip>Site 5</SiteChip>
      <SiteChip>Site 6</SiteChip>
      <SiteChip more onClick={() => {}}>+8 more</SiteChip>
    </div>
  ),
};
