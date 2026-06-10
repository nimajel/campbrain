import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import MapLegend from './MapLegend';

const meta = {
  title: 'Components/MapLegend',
  component: MapLegend,
  args: { dateFilterActive: false },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: 240, background: '#dce6d3', borderRadius: 8 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MapLegend>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithDateFilter: Story = { args: { dateFilterActive: true } };
