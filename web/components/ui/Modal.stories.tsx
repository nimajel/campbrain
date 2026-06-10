import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Modal from './Modal';
import Button from './Button';

function ModalDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Open modal</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New Camping Alert">
        <p style={{ marginTop: 0 }}>Modal body content goes here.</p>
        <div className="card-actions">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => setOpen(false)}>Save alert</Button>
        </div>
      </Modal>
    </>
  );
}

const meta = {
  title: 'UI/Modal',
  component: Modal,
  args: { open: true, onClose: () => {}, title: 'New Camping Alert', children: 'Body' },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
export const Interactive: Story = { render: () => <ModalDemo /> };
