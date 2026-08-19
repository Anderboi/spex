import PageContainer from '@/components/layout/page-container';
import { Metadata } from 'next';
import React from "react";

export const metadata: Metadata = {
  title: { default: "Spex", template: "%s | Spex" },
};
const MaterialPageLayout = ({ children }: { children: React.ReactNode }) => {
  return <PageContainer> {children}</PageContainer>;
};

export default MaterialPageLayout;
