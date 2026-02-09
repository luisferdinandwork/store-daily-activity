// app/components/ui/page-header.tsx
'use client';

import { Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface PageHeaderProps {
  title: string;
  icon?: React.ReactNode;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  showBackButton?: boolean;
  onBackClick?: () => void;
  showTime?: boolean;
  backgroundColor?: string;
}

export default function PageHeader({
  title,
  icon,
  searchQuery = '',
  onSearchChange,
  showBackButton = true,
  onBackClick,
  showTime = true,
  backgroundColor = 'bg-primary'
}: PageHeaderProps) {
  const formatTime = () => {
    return new Date().toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
  };

  return (
    <div className={`${backgroundColor} text-white px-6 pt-6 pb-10 relative overflow-hidden rounded-b-2xl`}>
      {/* Back Button */}
      {showBackButton && (
        <button 
          onClick={onBackClick || (() => window.history.back())}
          className="mb-4 flex items-center text-white/90 hover:text-white transition-colors duration-200"
          aria-label="Go back"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="text-sm font-medium">Back</span>
        </button>
      )}
      
      {/* Title with icon */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {icon && (
          <div className="relative">
            <div className="absolute -top-2 -right-2">
              <Sparkles className="h-4 w-4 text-yellow-300 animate-pulse" />
            </div>
            <div className="text-5xl transform rotate-12">{icon}</div>
          </div>
        )}
      </div>

      {/* Time Display */}
      {showTime && (
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-medium">{formatTime()}</div>
          <div className="flex gap-1">
            <div className="w-1 h-4 bg-white rounded"></div>
            <div className="w-1 h-4 bg-white rounded"></div>
            <div className="w-1 h-4 bg-white rounded"></div>
            <div className="w-1 h-4 bg-white rounded"></div>
          </div>
        </div>
      )}

      {/* Search Bar */}
      {onSearchChange && (
        <div className="relative max-w-md mx-auto">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-3 bg-white/20 backdrop-blur-md border border-white/30 rounded-lg text-white placeholder-white/70 focus:outline-none focus:ring-2 focus:ring-white/50 focus:border-transparent transition-all duration-200"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}