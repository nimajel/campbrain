import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import SiteFilterPanel from './SiteFilterPanel';
import { EMPTY_TAXONOMY } from '../../lib/site-taxonomy';
import type { TaxonomyState } from '../../lib/site-taxonomy';

function ActiveDemo() {
  const [state, setState] = useState<TaxonomyState>({ access: ['drive_in'], kinds: [], hide: ['group'] });
  return <SiteFilterPanel state={state} onChange={setState} />;
}

function PanelDemo({ groups, dense }: { groups?: Array<'access' | 'kinds' | 'hide'>; dense?: boolean }) {
  const [state, setState] = useState<TaxonomyState>(EMPTY_TAXONOMY);
  return <SiteFilterPanel state={state} onChange={setState} groups={groups} dense={dense} />;
}

const meta = {
  title: 'Components/SiteFilterPanel',
  component: SiteFilterPanel,
  args: { state: EMPTY_TAXONOMY, onChange: () => {} },
} satisfies Meta<typeof SiteFilterPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllGroups: Story = { render: () => <PanelDemo /> };
export const Dense: Story = { render: () => <PanelDemo dense /> };
export const HideGroupOnly: Story = { render: () => <PanelDemo groups={['hide']} /> };
export const WithFiltersActive: Story = {
  render: () => <ActiveDemo /> ,
};
