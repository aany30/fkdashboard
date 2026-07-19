import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useAuthStore } from "@/store/auth";

export default function AccountSelector() {
  const {
    metaPixelList,
    selectedMetaPixelId,
    setSelectedMetaPixelId,
  } = useAuthStore();

  const [metaOpen, setMetaOpen] = useState(false);

  const selectedMetaPixel = metaPixelList.find((p) => p.id === selectedMetaPixelId);

  return (
    <div className="flex gap-4 items-center">
      {/* Meta Pixel Selector */}
      {metaPixelList.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setMetaOpen(!metaOpen)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            <span className="truncate max-w-xs">
              {selectedMetaPixel?.name || "Select Pixel"}
            </span>
            <ChevronDown className="w-4 h-4 flex-shrink-0" />
          </button>

          {metaOpen && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-20 min-w-xs">
              {metaPixelList.map((pixel) => (
                <button
                  key={pixel.id}
                  onClick={() => {
                    setSelectedMetaPixelId(pixel.id);
                    setMetaOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm transition ${
                    selectedMetaPixelId === pixel.id
                      ? "bg-blue-50 text-blue-600 font-semibold"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <div className="font-medium">{pixel.name}</div>
                  <div className="text-xs text-gray-500">{pixel.id}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
