// components/ops/store-heatmap.tsx
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { Calendar } from 'lucide-react';

interface Store {
  id: string;
  name: string;
}

interface StoreHeatmapProps {
  stores: Store[];
  date: Date;
}

interface HeatmapData {
  storeId: string;
  storeName: string;
  date: string;
  performance: 'perfect' | 'good' | 'bad';
  completedTasks: number;
  totalTasks: number;
}

export function StoreHeatmap({ stores, date }: StoreHeatmapProps) {
  const [selectedPeriod, setSelectedPeriod] = useState('7'); // days
  const [heatmapData, setHeatmapData] = useState<HeatmapData[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchHeatmapData = async () => {
      setIsLoading(true);
      try {
        const endDate = endOfDay(date);
        const startDate = startOfDay(subDays(date, parseInt(selectedPeriod) - 1));

        const response = await fetch(
          `/api/ops/heatmap?startDate=${format(startDate, 'yyyy-MM-dd')}&endDate=${format(endDate, 'yyyy-MM-dd')}`
        );

        if (response.ok) {
          const data = await response.json();
          setHeatmapData(data.heatmap);
        }
      } catch (error) {
        console.error('Failed to fetch heatmap data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchHeatmapData();
  }, [date, selectedPeriod]);

  const getHeatmapColor = (performance: string) => {
    switch (performance) {
      case 'perfect':
        return 'bg-green-500';
      case 'good':
        return 'bg-yellow-500';
      case 'bad':
        return 'bg-red-500';
      default:
        return 'bg-gray-300';
    }
  };

  const getHeatmapDates = () => {
    const dates = [];
    for (let i = parseInt(selectedPeriod) - 1; i >= 0; i--) {
      dates.push(format(subDays(date, i), 'yyyy-MM-dd'));
    }
    return dates;
  };

  const getHeatmapValue = (storeId: string, date: string) => {
    const data = heatmapData.find(
      (item) => item.storeId === storeId && item.date === date
    );
    return data;
  };

  if (isLoading) {
    return <div className="flex justify-center p-8">Loading heatmap data...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Store Performance Heatmap</h3>
        <div className="flex items-center gap-2">
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-full">
          <div className="grid grid-cols-[150px_repeat(auto-fill,_minmax(40px,_1fr))] gap-1">
            {/* Header row with dates */}
            <div className="p-2 text-sm font-medium">Store</div>
            {getHeatmapDates().map((date) => (
              <div key={date} className="p-1 text-center text-xs">
                {format(new Date(date), 'd')}
              </div>
            ))}

            {/* Data rows for each store */}
            {stores.map((store) => (
              <>
                <div key={store.id} className="p-2 text-sm font-medium truncate">
                  {store.name}
                </div>
                {getHeatmapDates().map((date) => {
                  const data = getHeatmapValue(store.id, date);
                  return (
                    <div
                      key={`${store.id}-${date}`}
                      className={`h-8 rounded-sm ${getHeatmapColor(
                        data?.performance || 'none'
                      )} flex items-center justify-center`}
                      title={
                        data
                          ? `${store.name} - ${format(new Date(date), 'MMM d, yyyy')}: ${data.completedTasks}/${data.totalTasks} tasks completed`
                          : `${store.name} - ${format(new Date(date), 'MMM d, yyyy')}: No data`
                      }
                    >
                      {data && (
                        <span className="text-xs text-white font-medium">
                          {Math.round((data.completedTasks / data.totalTasks) * 100)}%
                        </span>
                      )}
                    </div>
                  );
                })}
              </>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 bg-green-500 rounded-sm"></div>
          <span>Perfect (90-100%)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 bg-yellow-500 rounded-sm"></div>
          <span>Good (70-89%)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 bg-red-500 rounded-sm"></div>
          <span>Bad (&lt;70%)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 bg-gray-300 rounded-sm"></div>
          <span>No Data</span>
        </div>
      </div>
    </div>
  );
}