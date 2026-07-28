'use client';
// components/ops/stores/StoreEditSheet.tsx
//
// Side sheet for creating a new store or editing an existing one's name,
// address, and geolocation (latitude/longitude/geofence radius).

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Crosshair, Loader2, Lock, MapPin, Store as StoreIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetHeader, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { StoreRow } from '@/app/api/ops/stores/route';

interface AreaOption {
  id: number;
  name: string;
}

interface Props {
  mode: 'create' | 'edit';
  store?: StoreRow;
  areas: AreaOption[];
  /** Locks the area picker to a single area (OPS Area scope, or "add store" from an empty area section). */
  fixedAreaId?: number;
  onClose: () => void;
  onSaved: () => void;
}

export default function StoreEditSheet({ mode, store, areas, fixedAreaId, onClose, onSaved }: Props) {
  const { data: session } = useSession();
  const isIt = (session?.user as any)?.role === 'it';

  const [storeNo, setStoreNo] = useState(store?.storeNo ?? '');
  const [name, setName] = useState(store?.name ?? '');
  const [address, setAddress] = useState(store?.address ?? '');
  const [areaId, setAreaId] = useState<string>(
    String(fixedAreaId ?? store?.areaId ?? areas[0]?.id ?? ''),
  );
  const [latitude, setLatitude] = useState(store?.latitude ?? '');
  const [longitude, setLongitude] = useState(store?.longitude ?? '');
  const [geofenceRadiusM, setGeofenceRadiusM] = useState(store?.geofenceRadiusM ?? '');
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const areaLocked = mode === 'edit' || fixedAreaId !== undefined;

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported on this device.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(7));
        setLongitude(pos.coords.longitude.toFixed(7));
        setLocating(false);
      },
      () => {
        toast.error('Could not get your current location.');
        setLocating(false);
      },
      { timeout: 10_000, maximumAge: 0 },
    );
  }

  async function handleSubmit() {
    setError(null);

    if (!name.trim()) { setError('Name is required.'); return; }
    if (mode === 'create' && !storeNo.trim()) { setError('Store code is required.'); return; }
    if (mode === 'create' && !address.trim()) { setError('Address is required.'); return; }
    if (mode === 'create' && !areaId) { setError('Area is required.'); return; }
    if (isIt && ((latitude && !longitude) || (!latitude && longitude))) {
      setError('Provide both latitude and longitude, or leave both empty.');
      return;
    }

    setSaving(true);
    try {
      const location = isIt
        ? {
            latitude: latitude || null,
            longitude: longitude || null,
            geofenceRadiusM: geofenceRadiusM || null,
          }
        : {};

      const payload =
        mode === 'create'
          ? {
              storeNo: storeNo.trim(),
              name: name.trim(),
              address: address.trim(),
              areaId: Number(areaId),
              ...location,
            }
          : {
              name: name.trim(),
              address: address.trim(),
              ...location,
            };

      const url = mode === 'create' ? '/api/ops/stores' : `/api/ops/stores/${store!.id}`;
      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data?.error ?? 'Failed to save store.');
      }

      toast.success(mode === 'create' ? 'Store created.' : 'Store updated.');
      onSaved();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <StoreIcon className="h-4 w-4 text-indigo-500" />
            {mode === 'create' ? 'Add Store' : `Edit ${store?.name}`}
          </SheetTitle>
          <SheetDescription>
            {mode === 'create'
              ? 'Create a new store and set its location.'
              : 'Update the store name and its map location.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              {error}
            </div>
          )}

          {mode === 'create' && (
            <div className="space-y-1.5">
              <Label htmlFor="storeNo">Store code</Label>
              <Input
                id="storeNo"
                value={storeNo}
                onChange={(e) => setStoreNo(e.target.value)}
                placeholder="e.g. FF001"
                disabled={saving}
              />
              <p className="text-[11px] text-muted-foreground">
                Must match the Business Central / POS store code exactly.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="name">Store name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Fisik Football - Daan Mogot"
              disabled={saving}
            />
          </div>

          {mode === 'create' && (
            <div className="space-y-1.5">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. DKI · Daan Mogot, DKI Jakarta"
                disabled={saving}
              />
            </div>
          )}

          {mode === 'create' && (
            <div className="space-y-1.5">
              <Label htmlFor="area">Area</Label>
              <Select value={areaId} onValueChange={setAreaId} disabled={saving || areaLocked}>
                <SelectTrigger id="area" className="w-full">
                  <SelectValue placeholder="Select area" />
                </SelectTrigger>
                <SelectContent>
                  {areas.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2 rounded-xl border border-border bg-secondary/40 p-3">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <MapPin className="h-3.5 w-3.5" />
                Location
                {!isIt && <Lock className="h-3 w-3 text-muted-foreground" />}
              </p>
              {isIt && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={useCurrentLocation}
                  disabled={saving || locating}
                  className="h-7 gap-1.5 text-xs"
                >
                  {locating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Crosshair className="h-3 w-3" />}
                  Use current location
                </Button>
              )}
            </div>

            {!isIt && (
              <p className="text-[11px] text-muted-foreground">Only IT can change a store's location.</p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="latitude" className="text-[11px] font-normal text-muted-foreground">Latitude</Label>
                <Input
                  id="latitude"
                  inputMode="decimal"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  placeholder="-6.1630687"
                  disabled={saving || !isIt}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="longitude" className="text-[11px] font-normal text-muted-foreground">Longitude</Label>
                <Input
                  id="longitude"
                  inputMode="decimal"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  placeholder="106.7739266"
                  disabled={saving || !isIt}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="geofenceRadiusM" className="text-[11px] font-normal text-muted-foreground">
                Geofence radius (meters)
              </Label>
              <Input
                id="geofenceRadiusM"
                inputMode="decimal"
                value={geofenceRadiusM}
                onChange={(e) => setGeofenceRadiusM(e.target.value)}
                placeholder="100"
                disabled={saving || !isIt}
              />
              <p className="text-[11px] text-muted-foreground">
                How close an employee must be to this point to check in.
              </p>
            </div>
          </div>
        </div>

        <SheetFooter className="flex-row gap-2 border-t border-border">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving} className="flex-1">
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saving} className="flex-1 gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'create' ? 'Create Store' : 'Save Changes'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
