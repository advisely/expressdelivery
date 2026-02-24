/* eslint-disable react-refresh/only-export-components */
import type { FC } from 'react';

interface IconProps {
    size?: number;
}

const GmailIcon: FC<IconProps> = ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 6C2 4.9 2.9 4 4 4H20C21.1 4 22 4.9 22 6V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6Z" fill="#F6F6F6"/>
        <path d="M2 6L12 13L22 6" stroke="#EA4335" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 6V18C2 19.1 2.9 20 4 20H6V9.5L12 13" stroke="#4285F4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M22 6V18C22 19.1 21.1 20 20 20H18V9.5L12 13" stroke="#34A853" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M6 20V9.5L2 6" stroke="#FBBC04" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M18 20V9.5L22 6" stroke="#EA4335" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);

const OutlookIcon: FC<IconProps> = ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="4" width="18" height="16" rx="2" fill="#0078D4"/>
        <path d="M3 8L12 14L21 8" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <rect x="3" y="4" width="18" height="16" rx="2" stroke="#0078D4" strokeWidth="0.5"/>
        <path d="M3 8V18C3 19.1 3.9 20 5 20H19C20.1 20 21 19.1 21 18V8" stroke="#005A9E" strokeWidth="0.5"/>
    </svg>
);

const YahooIcon: FC<IconProps> = ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="2" width="20" height="20" rx="4" fill="#6001D2"/>
        <path d="M7 7L12 13.5V17.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M17 7L12 13.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="17.5" cy="7.5" r="1.5" fill="#FF0080"/>
    </svg>
);

const ICloudIcon: FC<IconProps> = ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M18.5 17H7C4.24 17 2 14.76 2 12C2 9.5 3.86 7.43 6.33 7.05C7.04 4.72 9.22 3 11.8 3C14.79 3 17.23 5.24 17.5 8.08C19.96 8.36 22 10.35 22 13C22 15.76 19.76 17 18.5 17Z" fill="#007AFF"/>
        <path d="M18.5 17H7C4.24 17 2 14.76 2 12C2 9.5 3.86 7.43 6.33 7.05C7.04 4.72 9.22 3 11.8 3C14.79 3 17.23 5.24 17.5 8.08C19.96 8.36 22 10.35 22 13C22 15.76 19.76 17 18.5 17Z" fill="url(#icloud_grad)" fillOpacity="0.3"/>
        <defs>
            <linearGradient id="icloud_grad" x1="12" y1="3" x2="12" y2="17" gradientUnits="userSpaceOnUse">
                <stop stopColor="white" stopOpacity="0.5"/>
                <stop offset="1" stopColor="white" stopOpacity="0"/>
            </linearGradient>
        </defs>
    </svg>
);

const CustomMailIcon: FC<IconProps> = ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/>
        <path d="M3 7L12 13L21 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>
    </svg>
);

export const PROVIDER_ICONS: Record<string, FC<IconProps>> = {
    gmail: GmailIcon,
    outlook: OutlookIcon,
    yahoo: YahooIcon,
    icloud: ICloudIcon,
    custom: CustomMailIcon,
};

export const getProviderIcon = (providerId: string): FC<IconProps> =>
    PROVIDER_ICONS[providerId] ?? PROVIDER_ICONS.custom;
