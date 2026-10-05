import { redirect } from 'next/navigation';

// The Inbox is the home page.
export default function Home() {
  redirect('/listings');
}
