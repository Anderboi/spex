'use client'
import SpecBuilder from '@/components/spec-builder/SpecBuilder';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  router.push('/projects');
  return <SpecBuilder />;
}