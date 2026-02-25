import { Region } from '../types';

export interface ProcessedPuzzleData {
  regions: Region[];
  imageA: string; // Base64, potentially resized
  imageB: string; // Base64, potentially resized
}

export async function detectDifferencesClientSide(imageASrc: string, imageBSrc: string): Promise<ProcessedPuzzleData> {
  return new Promise((resolve, reject) => {
    const imgA = new Image();
    const imgB = new Image();
    
    let loadedCount = 0;
    const onLoad = () => {
      loadedCount++;
      if (loadedCount === 2) {
        processImages(imgA, imgB, imageASrc, imageBSrc).then(resolve).catch(reject);
      }
    };

    imgA.onload = onLoad;
    imgB.onload = onLoad;
    imgA.onerror = () => reject(new Error("Failed to load images"));
    imgB.onerror = () => reject(new Error("Failed to load images"));

    imgA.src = imageASrc;
    imgB.src = imageBSrc;
  });
}

async function processImages(imgA: HTMLImageElement, imgB: HTMLImageElement, srcA: string, srcB: string): Promise<ProcessedPuzzleData> {
  // 1. Normalize dimensions to match Image A
  const width = imgA.width;
  const height = imgA.height;

  // Create canvas for Image B (resize to match A if needed)
  let finalImageB = srcB;
  
  if (imgB.width !== width || imgB.height !== height) {
    const canvasB = document.createElement('canvas');
    canvasB.width = width;
    canvasB.height = height;
    const ctxB = canvasB.getContext('2d', { willReadFrequently: true });
    if (!ctxB) throw new Error('Could not get canvas context');
    ctxB.drawImage(imgB, 0, 0, width, height); // This handles the resizing/stretching
    finalImageB = canvasB.toDataURL('image/png');
  }

  // 2. Compute Difference & Threshold
  // Processing at full resolution might be slow for huge images, 
  // but for accuracy in the game we want the full images.
  // For detection logic, we can downscale if needed, but let's try full res first 
  // or downscale just for the diff map calculation.
  
  const procScale = Math.min(1, 800 / width); // Process at max 800px width
  const procW = Math.floor(width * procScale);
  const procH = Math.floor(height * procScale);

  // Draw to small canvases for diff computation
  const smallCanvasA = document.createElement('canvas');
  smallCanvasA.width = procW;
  smallCanvasA.height = procH;
  const smallCtxA = smallCanvasA.getContext('2d', { willReadFrequently: true })!;
  // Apply blur to reduce high-frequency noise/artifacts
  smallCtxA.filter = 'blur(2px)';
  smallCtxA.drawImage(imgA, 0, 0, procW, procH);
  const smallDataA = smallCtxA.getImageData(0, 0, procW, procH).data;

  const smallCanvasB = document.createElement('canvas');
  smallCanvasB.width = procW;
  smallCanvasB.height = procH;
  const smallCtxB = smallCanvasB.getContext('2d', { willReadFrequently: true })!;
  // Apply blur to reduce high-frequency noise/artifacts
  smallCtxB.filter = 'blur(2px)';
  smallCtxB.drawImage(imgB, 0, 0, procW, procH); // Resized B drawn to small canvas
  const smallDataB = smallCtxB.getImageData(0, 0, procW, procH).data;

  const binaryMap = new Uint8Array(procW * procH);
  // Threshold for RGB sum difference. 
  // 45 is roughly 15 per channel on average, which is a decent tolerance for compression noise
  // while still catching visible color shifts.
  const diffThreshold = 60; 

  for (let i = 0; i < smallDataA.length; i += 4) {
    const r1 = smallDataA[i];
    const g1 = smallDataA[i + 1];
    const b1 = smallDataA[i + 2];

    const r2 = smallDataB[i];
    const g2 = smallDataB[i + 1];
    const b2 = smallDataB[i + 2];

    // Manhattan distance for speed and effectiveness
    const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
    
    if (diff > diffThreshold) {
      binaryMap[i / 4] = 1;
    }
  }

  // 3. Morphological Operations
  // Increased passes to merge nearby pixels more aggressively
  const dilatedMap = dilate(binaryMap, procW, procH, 6); 

  // 4. Find Regions
  let rects = findContours(dilatedMap, procW, procH);

  // 5. Merge nearby regions to reduce fragmentation
  // Merge regions within ~20px of each other (scaled)
  const mergeDistance = Math.max(10, Math.floor(20 * procScale));
  rects = mergeNearbyRects(rects, mergeDistance);

  // 6. Filter and Convert
  const finalRegions: Region[] = [];
  const minArea = (procW * procH) * 0.001; // 0.1% area threshold (increased from 0.05% to reduce noise)

  rects.forEach(rect => {
    const area = rect.width * rect.height;
    if (area > minArea) {
      // Add padding
      const padding = 5;
      const x = Math.max(0, rect.x - padding);
      const y = Math.max(0, rect.y - padding);
      const w = Math.min(procW - x, rect.width + padding * 2);
      const h = Math.min(procH - y, rect.height + padding * 2);

      finalRegions.push({
        id: Math.random().toString(36).substring(2),
        x: x / procW,
        y: y / procH,
        width: w / procW,
        height: h / procH
      });
    }
  });

  return {
    regions: finalRegions,
    imageA: srcA,
    imageB: finalImageB
  };
}

function mergeNearbyRects(rects: Rect[], distance: number): Rect[] {
  let merged = [...rects];
  let changed = true;
  
  while (changed) {
    changed = false;
    const newMerged: Rect[] = [];
    const used = new Array(merged.length).fill(false);
    
    for (let i = 0; i < merged.length; i++) {
      if (used[i]) continue;
      
      let current = { ...merged[i] };
      used[i] = true;
      
      for (let j = i + 1; j < merged.length; j++) {
        if (used[j]) continue;
        
        const other = merged[j];
        
        // Check if close enough by expanding current rect by distance
        const expanded = {
            x: current.x - distance,
            y: current.y - distance,
            width: current.width + distance * 2,
            height: current.height + distance * 2
        };
        
        if (rectsIntersect(expanded, other)) {
            // Merge
            const minX = Math.min(current.x, other.x);
            const minY = Math.min(current.y, other.y);
            const maxX = Math.max(current.x + current.width, other.x + other.width);
            const maxY = Math.max(current.y + current.height, other.y + other.height);
            
            current.x = minX;
            current.y = minY;
            current.width = maxX - minX;
            current.height = maxY - minY;
            
            used[j] = true;
            changed = true;
        }
      }
      newMerged.push(current);
    }
    merged = newMerged;
  }
  return merged;
}

function rectsIntersect(r1: Rect, r2: Rect) {
  return !(r2.x > r1.x + r1.width || 
           r2.x + r2.width < r1.x || 
           r2.y > r1.y + r1.height || 
           r2.y + r2.height < r1.y);
}

function dilate(data: Uint8Array, width: number, height: number, passes: number): Uint8Array {
  let current = new Uint8Array(data);
  let next = new Uint8Array(data.length);

  for (let p = 0; p < passes; p++) {
    // Initialize next with current values to preserve existing white pixels
    next.set(current);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (current[idx] === 1) {
          // Expand to neighbors (3x3 kernel)
          // Top
          if (y > 0) {
            next[idx - width] = 1;
            if (x > 0) next[idx - width - 1] = 1;
            if (x < width - 1) next[idx - width + 1] = 1;
          }
          // Bottom
          if (y < height - 1) {
            next[idx + width] = 1;
            if (x > 0) next[idx + width - 1] = 1;
            if (x < width - 1) next[idx + width + 1] = 1;
          }
          // Left/Right
          if (x > 0) next[idx - 1] = 1;
          if (x < width - 1) next[idx + 1] = 1;
        }
      }
    }
    current.set(next);
  }
  return current;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function findContours(data: Uint8Array, width: number, height: number): Rect[] {
  const visited = new Uint8Array(data.length);
  const rects: Rect[] = [];

  // Simple blob detection using BFS
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 1 && visited[i] === 0) {
      let minX = i % width;
      let maxX = minX;
      let minY = Math.floor(i / width);
      let maxY = minY;
      
      const queue = [i];
      visited[i] = 1;
      
      let ptr = 0;
      while(ptr < queue.length) {
        const idx = queue[ptr++];
        const x = idx % width;
        const y = Math.floor(idx / width);
        
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        
        // Neighbors
        const neighbors = [
          idx - 1, idx + 1, idx - width, idx + width,
          idx - width - 1, idx - width + 1, idx + width - 1, idx + width + 1
        ];
        
        for (const n of neighbors) {
          if (n >= 0 && n < data.length && data[n] === 1 && visited[n] === 0) {
            // Check boundary wrapping
            const nx = n % width;
            const cx = idx % width;
            if (Math.abs(nx - cx) > 1) continue;
            
            visited[n] = 1;
            queue.push(n);
          }
        }
      }
      
      rects.push({
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
      });
    }
  }
  return rects;
}
