import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { platform } from "os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HardwareResult = {
  platform: string;
  os_version: string;
  cpu: string;
  cpu_cores: number;
  cpu_physical_cores: number;
  ram_gb: number;
  gpu: string;
  gpu_vram: string;
  gpu_metal: string;
  model_name: string;
  chip: string;
  is_apple_silicon: boolean;
  unified_memory: boolean;
};

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

function detectMacOS(): HardwareResult {
  const memBytes = parseInt(run("sysctl -n hw.memsize"), 10);
  const ramGb = memBytes > 0 ? Math.round(memBytes / (1024 * 1024 * 1024)) : 0;
  const cpuCores = parseInt(run("sysctl -n hw.ncpu"), 10) || 0;
  const physCores = parseInt(run("sysctl -n hw.physicalcpu"), 10) || cpuCores;
  const cpuBrand = run("sysctl -n machdep.cpu.brand_string");
  const osVersion = run("sw_vers -productVersion");
  const hwModel = run("sysctl -n hw.model");

  // GPU info from system_profiler
  const gpuInfo = run("system_profiler SPDisplaysDataType 2>/dev/null");
  const chipMatch = gpuInfo.match(/Chipset Model:\s*(.+)/);
  const metalMatch = gpuInfo.match(/Metal Support:\s*(.+)/);
  const vramMatch = gpuInfo.match(/VRAM.*?:\s*(.+)/);

  // Hardware overview
  const hwInfo = run("system_profiler SPHardwareDataType 2>/dev/null");
  const chipLine = hwInfo.match(/Chip:\s*(.+)/);
  const modelLine = hwInfo.match(/Model Name:\s*(.+)/);
  const memLine = hwInfo.match(/Memory:\s*(.+)/);
  const coreLine = hwInfo.match(/Total Number of Cores:\s*(.+)/);

  const chip = chipLine?.[1] ?? cpuBrand;
  const isAppleSilicon = chip.includes("Apple") || cpuBrand.includes("Apple");

  // If system_profiler reports memory, use that (more accurate)
  let finalRam = ramGb;
  if (memLine) {
    const memNum = parseInt(memLine[1], 10);
    if (memNum > 0) finalRam = memNum;
  }

  return {
    platform: "macOS",
    os_version: osVersion,
    cpu: chip,
    cpu_cores: cpuCores,
    cpu_physical_cores: physCores,
    ram_gb: finalRam,
    gpu: chipMatch?.[1] ?? chip,
    gpu_vram: isAppleSilicon ? `${finalRam}GB unified` : (vramMatch?.[1] ?? "Unknown"),
    gpu_metal: metalMatch?.[1] ?? "Unknown",
    model_name: modelLine?.[1] ?? hwModel,
    chip,
    is_apple_silicon: isAppleSilicon,
    unified_memory: isAppleSilicon,
  };
}

function detectLinux(): HardwareResult {
  const memInfo = run("grep MemTotal /proc/meminfo");
  const memKb = parseInt(memInfo.replace(/\D/g, ""), 10);
  const ramGb = memKb > 0 ? Math.round(memKb / (1024 * 1024)) : 0;

  const cpuInfo = run("lscpu 2>/dev/null");
  const cpuModel = cpuInfo.match(/Model name:\s*(.+)/)?.[1] ?? run("uname -p");
  const cpuCores = parseInt(cpuInfo.match(/^CPU\(s\):\s*(\d+)/m)?.[1] ?? "0", 10) || parseInt(run("nproc"), 10) || 0;
  const physCores = parseInt(cpuInfo.match(/Core\(s\) per socket:\s*(\d+)/)?.[1] ?? "0", 10) || cpuCores;

  // GPU
  const lspci = run("lspci 2>/dev/null | grep -i 'vga\\|3d\\|display'");
  const nvidiaSmi = run("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null");

  let gpu = "Unknown";
  let vram = "Unknown";
  if (nvidiaSmi) {
    const parts = nvidiaSmi.split(",").map(s => s.trim());
    gpu = parts[0] ?? "NVIDIA GPU";
    vram = parts[1] ?? "Unknown";
  } else if (lspci) {
    gpu = lspci.split(":").pop()?.trim() ?? "Unknown";
  }

  return {
    platform: "Linux",
    os_version: run("uname -r"),
    cpu: cpuModel,
    cpu_cores: cpuCores,
    cpu_physical_cores: physCores,
    ram_gb: ramGb,
    gpu,
    gpu_vram: vram,
    gpu_metal: "N/A",
    model_name: run("hostname"),
    chip: cpuModel,
    is_apple_silicon: false,
    unified_memory: false,
  };
}

function detectWindows(): HardwareResult {
  const cpuName = run('wmic cpu get name /value 2>nul').replace("Name=", "");
  const cpuCores = parseInt(run('wmic cpu get NumberOfLogicalProcessors /value 2>nul').replace(/\D/g, ""), 10) || 0;
  const physCores = parseInt(run('wmic cpu get NumberOfCores /value 2>nul').replace(/\D/g, ""), 10) || cpuCores;
  const memBytes = parseInt(run('wmic computersystem get TotalPhysicalMemory /value 2>nul').replace(/\D/g, ""), 10);
  const ramGb = memBytes > 0 ? Math.round(memBytes / (1024 * 1024 * 1024)) : 0;
  const gpuName = run('wmic path win32_videocontroller get name /value 2>nul').replace("Name=", "");
  const vram = run('wmic path win32_videocontroller get AdapterRAM /value 2>nul').replace(/\D/g, "");
  const vramGb = parseInt(vram, 10) > 0 ? `${Math.round(parseInt(vram, 10) / (1024 * 1024 * 1024))}GB` : "Unknown";

  return {
    platform: "Windows",
    os_version: run('ver 2>nul') || run('wmic os get version /value 2>nul').replace("Version=", ""),
    cpu: cpuName || "Unknown",
    cpu_cores: cpuCores,
    cpu_physical_cores: physCores,
    ram_gb: ramGb,
    gpu: gpuName || "Unknown",
    gpu_vram: vramGb,
    gpu_metal: "N/A",
    model_name: run('wmic computersystem get model /value 2>nul').replace("Model=", "") || "Unknown",
    chip: cpuName || "Unknown",
    is_apple_silicon: false,
    unified_memory: false,
  };
}

export async function GET() {
  try {
    const os = platform();
    let result: HardwareResult;

    if (os === "darwin") {
      result = detectMacOS();
    } else if (os === "linux") {
      result = detectLinux();
    } else if (os === "win32") {
      result = detectWindows();
    } else {
      result = {
        platform: os, os_version: "Unknown", cpu: "Unknown", cpu_cores: 0, cpu_physical_cores: 0,
        ram_gb: 0, gpu: "Unknown", gpu_vram: "Unknown", gpu_metal: "N/A",
        model_name: "Unknown", chip: "Unknown", is_apple_silicon: false, unified_memory: false,
      };
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hardware detection failed." },
      { status: 500 }
    );
  }
}
