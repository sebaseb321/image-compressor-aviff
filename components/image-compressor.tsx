"use client"

import type React from "react"

import { useState, useCallback, useRef } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import { Upload, Download, ImageIcon, Loader2, X, Crop } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import Cropper from "react-easy-crop"
import type { Area } from "react-easy-crop"

interface CompressedImage {
  file: File
  preview: string
  compressedPreview?: string
  compressed?: Blob
  originalSize: number
  compressedSize?: number
  processing?: boolean
  dimensions?: { width: number; height: number }
  quality: number
  width: string
  height: string
}

interface CropState {
  crop: { x: number; y: number }
  zoom: number
  croppedAreaPixels: Area | null
}

interface AspectRatioState {
  type: "free" | "preset" | "custom"
  value: number | undefined
  customWidth: string
  customHeight: string
}

export default function ImageCompressor() {
  const [images, setImages] = useState<CompressedImage[]>([])
  const { toast } = useToast()
  const previewTimeoutRefs = useRef<Map<number, NodeJS.Timeout>>(new Map())

  const [cropModalOpen, setCropModalOpen] = useState(false)
  const [currentCropIndex, setCurrentCropIndex] = useState<number | null>(null)
  const [cropState, setCropState] = useState<CropState>({
    crop: { x: 0, y: 0 },
    zoom: 1,
    croppedAreaPixels: null,
  })

  const [aspectRatio, setAspectRatio] = useState<AspectRatioState>({
    type: "free",
    value: undefined,
    customWidth: "16",
    customHeight: "9",
  })

  const presetAspectRatios = [
    { label: "1:1 (Cuadrado)", value: 1 },
    { label: "4:5 (Vertical)", value: 4 / 5 },
    { label: "5:4 (Horizontal)", value: 5 / 4 },
    { label: "16:9 (Panorámico)", value: 16 / 9 },
    { label: "9:16 (Stories)", value: 9 / 16 },
    { label: "3:2 (Fotografía)", value: 3 / 2 },
    { label: "2:3 (Retrato)", value: 2 / 3 },
  ]

  const calculateCustomAspectRatio = (): number | undefined => {
    const width = Number.parseFloat(aspectRatio.customWidth)
    const height = Number.parseFloat(aspectRatio.customHeight)
    if (width > 0 && height > 0) {
      return width / height
    }
    return undefined
  }

  const getCurrentAspectRatio = (): number | undefined => {
    if (aspectRatio.type === "free") return undefined
    if (aspectRatio.type === "preset") return aspectRatio.value
    if (aspectRatio.type === "custom") return calculateCustomAspectRatio()
    return undefined
  }

  const createCroppedImage = async (imageSrc: string, croppedAreaPixels: Area): Promise<{ file: File; blob: Blob }> => {
    const image = await createImageBitmap(await fetch(imageSrc).then((r) => r.blob()))
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")

    if (!ctx) {
      throw new Error("No se pudo obtener el contexto del canvas")
    }

    canvas.width = croppedAreaPixels.width
    canvas.height = croppedAreaPixels.height

    ctx.drawImage(
      image,
      croppedAreaPixels.x,
      croppedAreaPixels.y,
      croppedAreaPixels.width,
      croppedAreaPixels.height,
      0,
      0,
      croppedAreaPixels.width,
      croppedAreaPixels.height,
    )

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Error al crear la imagen recortada"))
          return
        }
        const file = new File([blob], "cropped-image.png", { type: "image/png" })
        resolve({ file, blob })
      }, "image/png")
    })
  }

  const openCropModal = (index: number) => {
    setCurrentCropIndex(index)
    setCropState({
      crop: { x: 0, y: 0 },
      zoom: 1,
      croppedAreaPixels: null,
    })
    setAspectRatio({
      type: "free",
      value: undefined,
      customWidth: "16",
      customHeight: "9",
    })
    setCropModalOpen(true)
  }

  const applyCrop = async () => {
    if (currentCropIndex === null || !cropState.croppedAreaPixels) return

    const img = images[currentCropIndex]
    if (!img) return

    try {
      const { file, blob } = await createCroppedImage(img.preview, cropState.croppedAreaPixels)

      const newPreview = URL.createObjectURL(blob)
      const dimensions = await getImageDimensions(file)

      setImages((prev) => {
        const newImages = [...prev]
        URL.revokeObjectURL(newImages[currentCropIndex].preview)
        if (newImages[currentCropIndex].compressedPreview) {
          URL.revokeObjectURL(newImages[currentCropIndex].compressedPreview!)
        }

        newImages[currentCropIndex] = {
          ...newImages[currentCropIndex],
          file,
          preview: newPreview,
          originalSize: blob.size,
          dimensions,
          compressedPreview: undefined,
          compressed: undefined,
          compressedSize: undefined,
        }
        return newImages
      })

      setCropModalOpen(false)
      setCurrentCropIndex(null)

      toast({
        title: "¡Éxito!",
        description: "Imagen recortada correctamente",
      })
    } catch (error) {
      console.error("Error al recortar:", error)
      toast({
        title: "Error",
        description: "Hubo un problema al recortar la imagen",
        variant: "destructive",
      })
    }
  }

  const compressImageWithJSquash = async (
    file: File,
    targetQuality: number,
    targetWidth?: number,
    targetHeight?: number,
    isPreview = false,
  ): Promise<{ blob: Blob; dimensions: { width: number; height: number } }> => {
    const { encode } = await import("@jsquash/avif")

    let canvasImageData: ImageData
    let finalWidth = 0
    let finalHeight = 0

    const img = await createImageBitmap(file)
    finalWidth = img.width
    finalHeight = img.height

    if (targetWidth || targetHeight) {
      if (targetWidth && targetHeight) {
        finalWidth = targetWidth
        finalHeight = targetHeight
      } else if (targetWidth) {
        finalWidth = targetWidth
        finalHeight = Math.round((img.height / img.width) * targetWidth)
      } else if (targetHeight) {
        finalHeight = targetHeight
        finalWidth = Math.round((img.width / img.height) * targetHeight)
      }

      const canvas = document.createElement("canvas")
      canvas.width = finalWidth
      canvas.height = finalHeight
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("No se pudo obtener el contexto del canvas")
      ctx.drawImage(img, 0, 0, finalWidth, finalHeight)

      canvasImageData = ctx.getImageData(0, 0, finalWidth, finalHeight)
    } else {
      const canvas = document.createElement("canvas")
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("No se pudo obtener el contexto del canvas")
      ctx.drawImage(img, 0, 0)
      canvasImageData = ctx.getImageData(0, 0, img.width, img.height)
    }

    const avifData = await encode(canvasImageData, {
      quality: targetQuality,
      speed: isPreview ? 8 : 4,
    })

    const blob = new Blob([avifData], { type: "image/avif" })

    return { blob, dimensions: { width: finalWidth, height: finalHeight } }
  }

  const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        resolve({ width: img.width, height: img.height })
      }
      img.src = URL.createObjectURL(file)
    })
  }

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files).filter((file) => file.type.startsWith("image/"))

      if (files.length === 0) {
        toast({
          title: "Error",
          description: "Por favor, sube solo archivos de imagen",
          variant: "destructive",
        })
        return
      }

      const newImages: CompressedImage[] = await Promise.all(
        files.map(async (file) => ({
          file,
          preview: URL.createObjectURL(file),
          originalSize: file.size,
          dimensions: await getImageDimensions(file),
          quality: 75,
          width: "",
          height: "",
        })),
      )

      setImages((prev) => [...prev, ...newImages])
    },
    [toast],
  )

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const newImages: CompressedImage[] = await Promise.all(
      files.map(async (file) => ({
        file,
        preview: URL.createObjectURL(file),
        originalSize: file.size,
        dimensions: await getImageDimensions(file),
        quality: 75,
        width: "",
        height: "",
      })),
    )
    setImages((prev) => [...prev, ...newImages])
  }

  const removeImage = (index: number) => {
    setImages((prev) => {
      const newImages = [...prev]
      URL.revokeObjectURL(newImages[index].preview)
      if (newImages[index].compressedPreview) {
        URL.revokeObjectURL(newImages[index].compressedPreview!)
      }
      newImages.splice(index, 1)
      return newImages
    })
  }

  const compressImage = async (index: number) => {
    const img = images[index]
    if (!img) return

    setImages((prev) => {
      const newImages = [...prev]
      newImages[index] = { ...newImages[index], processing: true }
      return newImages
    })

    try {
      const targetWidth = img.width ? Number.parseInt(img.width) : undefined
      const targetHeight = img.height ? Number.parseInt(img.height) : undefined

      const { blob } = await compressImageWithJSquash(img.file, img.quality, targetWidth, targetHeight, false)

      const compressedPreview = URL.createObjectURL(blob)

      setImages((prev) => {
        const newImages = [...prev]
        if (newImages[index].compressedPreview) {
          URL.revokeObjectURL(newImages[index].compressedPreview!)
        }
        newImages[index] = {
          ...newImages[index],
          compressed: blob,
          compressedSize: blob.size,
          compressedPreview,
          processing: false,
        }
        return newImages
      })

      toast({
        title: "¡Éxito!",
        description: "Imagen comprimida correctamente",
      })
    } catch (error) {
      console.error("Error al comprimir:", error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Hubo un problema al comprimir la imagen",
        variant: "destructive",
      })
      setImages((prev) => {
        const newImages = [...prev]
        newImages[index] = { ...newImages[index], processing: false }
        return newImages
      })
    }
  }

  const downloadImage = (img: CompressedImage, index: number) => {
    if (!img.compressed) return

    const url = URL.createObjectURL(img.compressed)
    const a = document.createElement("a")
    a.href = url
    a.download = `compressed-${index + 1}.avif`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i]
  }

  const calculateFinalDimensions = (img: CompressedImage) => {
    if (!img.dimensions) return null

    const targetWidth = img.width ? Number.parseInt(img.width) : null
    const targetHeight = img.height ? Number.parseInt(img.height) : null

    if (!targetWidth && !targetHeight) {
      return img.dimensions
    }

    if (targetWidth && targetHeight) {
      return { width: targetWidth, height: targetHeight }
    }

    const aspectRatio = img.dimensions.width / img.dimensions.height

    if (targetWidth) {
      return { width: targetWidth, height: Math.round(targetWidth / aspectRatio) }
    }

    if (targetHeight) {
      return { width: Math.round(targetHeight * aspectRatio), height: targetHeight }
    }

    return img.dimensions
  }

  const updateImageSettings = (index: number, field: "quality" | "width" | "height", value: number | string) => {
    setImages((prev) => {
      const newImages = [...prev]
      if (field === "quality") {
        newImages[index] = { ...newImages[index], quality: value as number }
      } else {
        newImages[index] = { ...newImages[index], [field]: value as string }
      }
      return newImages
    })

    const timeoutId = previewTimeoutRefs.current.get(index)
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    const newTimeoutId = setTimeout(() => {
      updatePreview(index)
    }, 1500)

    previewTimeoutRefs.current.set(index, newTimeoutId)
  }

  const updatePreview = async (index: number) => {
    const img = images[index]
    if (!img) return

    setImages((prev) => {
      const newImages = [...prev]
      newImages[index] = { ...newImages[index], processing: true }
      return newImages
    })

    try {
      const targetWidth = img.width ? Number.parseInt(img.width) : undefined
      const targetHeight = img.height ? Number.parseInt(img.height) : undefined

      const { blob } = await compressImageWithJSquash(img.file, img.quality, targetWidth, targetHeight, true)
      const compressedPreview = URL.createObjectURL(blob)

      setImages((prev) => {
        const newImages = [...prev]
        if (newImages[index].compressedPreview) {
          URL.revokeObjectURL(newImages[index].compressedPreview!)
        }
        newImages[index] = {
          ...newImages[index],
          compressedPreview,
          compressedSize: blob.size,
          processing: false,
        }
        return newImages
      })
    } catch (error) {
      console.error("Error en preview:", error)
      setImages((prev) => {
        const newImages = [...prev]
        newImages[index] = { ...newImages[index], processing: false }
        return newImages
      })
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-center py-8 border-border border-b-0">
        <div className="w-48 h-16 rounded-lg flex items-center justify-center bg-[rgba(54,54,54,0)]">
          <img
            src="/images/design-mode/Frame%201000003885(1).png"
            alt="Logo de la empresa"
            className="max-w-full max-h-full object-contain p-2"
          />
        </div>
      </div>

      <Card className="p-8">
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:border-primary transition-colors cursor-pointer"
        >
          <input type="file" id="file-input" multiple accept="image/*" onChange={handleFileInput} className="hidden" />
          <label htmlFor="file-input" className="cursor-pointer">
            <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg font-medium mb-2">Arrastra imágenes aquí o haz clic para seleccionar</p>
            <p className="text-sm text-muted-foreground">Soporta JPG, PNG, WebP y otros formatos</p>
          </label>
        </div>
      </Card>

      {images.length > 0 && (
        <div className="space-y-4">
          {images.map((img, index) => {
            const finalDimensions = calculateFinalDimensions(img)
            return (
              <Card key={index} className="p-6 relative">
                <Button
                  size="icon"
                  variant="destructive"
                  className="absolute top-4 right-4 z-10"
                  onClick={() => removeImage(index)}
                >
                  <X className="w-4 h-4" />
                </Button>

                <div className="mb-6">
                  <h3 className="text-lg font-semibold mb-4">Configuración - Imagen {index + 1}</h3>
                  <div className="grid md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <Label>Calidad: {img.quality}%</Label>
                      <Slider
                        value={[img.quality]}
                        onValueChange={(value) => updateImageSettings(index, "quality", value[0])}
                        min={1}
                        max={100}
                        step={1}
                        className="w-full"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`width-${index}`}>Ancho (px)</Label>
                      <Input
                        id={`width-${index}`}
                        type="number"
                        placeholder="Auto"
                        value={img.width}
                        onChange={(e) => updateImageSettings(index, "width", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`height-${index}`}>Alto (px)</Label>
                      <Input
                        id={`height-${index}`}
                        type="number"
                        placeholder="Auto"
                        value={img.height}
                        onChange={(e) => updateImageSettings(index, "height", e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid lg:grid-cols-2 gap-6 mb-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-muted-foreground">Original</p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openCropModal(index)}
                        disabled={img.processing}
                      >
                        <Crop className="w-4 h-4 mr-2" />
                        Recortar
                      </Button>
                    </div>
                    <div className="relative w-full bg-muted rounded-lg overflow-hidden" style={{ minHeight: "400px" }}>
                      <img
                        src={img.preview || "/placeholder.svg"}
                        alt={`Original ${index + 1}`}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">
                      {img.compressed ? "Comprimido AVIF" : "Vista previa"}
                    </p>
                    <div className="relative w-full bg-muted rounded-lg overflow-hidden" style={{ minHeight: "400px" }}>
                      {img.compressedPreview ? (
                        <img
                          src={img.compressedPreview || "/placeholder.svg"}
                          alt={`Compressed ${index + 1}`}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">
                          {img.processing ? (
                            <div className="flex flex-col items-center gap-2">
                              <Loader2 className="w-8 h-8 animate-spin" />
                              <span>Generando preview...</span>
                            </div>
                          ) : (
                            "Ajusta los controles para ver el preview"
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid lg:grid-cols-2 gap-6">
                  <div className="space-y-2 text-sm">
                    {img.dimensions && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Dimensiones:</span>
                        <span className="font-medium">
                          {img.dimensions.width} × {img.dimensions.height}
                          {finalDimensions &&
                            (finalDimensions.width !== img.dimensions.width ||
                              finalDimensions.height !== img.dimensions.height) && (
                              <span className="text-accent ml-1">
                                → {finalDimensions.width} × {finalDimensions.height}
                              </span>
                            )}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Peso original:</span>
                      <span className="font-medium">{formatSize(img.originalSize)}</span>
                    </div>
                    {img.compressedSize && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Peso AVIF:</span>
                          <span className="font-medium text-accent">{formatSize(img.compressedSize)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Reducción:</span>
                          <span className="font-medium text-accent">
                            {Math.round((1 - img.compressedSize / img.originalSize) * 100)}%
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex items-end">
                    {!img.compressed ? (
                      <Button
                        onClick={() => compressImage(index)}
                        disabled={img.processing}
                        className="w-full"
                        size="lg"
                      >
                        {img.processing ? (
                          <>
                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                            Comprimiendo...
                          </>
                        ) : (
                          <>
                            <ImageIcon className="w-5 h-5 mr-2" />
                            Comprimir
                          </>
                        )}
                      </Button>
                    ) : (
                      <Button onClick={() => downloadImage(img, index)} className="w-full" size="lg">
                        <Download className="w-5 h-5 mr-2" />
                        Descargar AVIF
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={cropModalOpen} onOpenChange={setCropModalOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Recortar imagen</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 border-b pb-4">
            <Label className="text-base font-semibold">Relación de aspecto</Label>

            {/* Free crop button */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant={aspectRatio.type === "free" ? "default" : "outline"}
                size="sm"
                onClick={() => setAspectRatio({ ...aspectRatio, type: "free", value: undefined })}
              >
                Libre
              </Button>

              {/* Preset aspect ratio buttons */}
              {presetAspectRatios.map((preset) => (
                <Button
                  key={preset.label}
                  variant={aspectRatio.type === "preset" && aspectRatio.value === preset.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAspectRatio({ ...aspectRatio, type: "preset", value: preset.value })}
                >
                  {preset.label}
                </Button>
              ))}
            </div>

            {/* Custom aspect ratio inputs */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button
                  variant={aspectRatio.type === "custom" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAspectRatio({ ...aspectRatio, type: "custom" })}
                >
                  Personalizado
                </Button>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="Ancho"
                    value={aspectRatio.customWidth}
                    onChange={(e) => setAspectRatio({ ...aspectRatio, customWidth: e.target.value, type: "custom" })}
                    className="w-20"
                    min="1"
                    step="0.1"
                  />
                  <span className="text-muted-foreground">:</span>
                  <Input
                    type="number"
                    placeholder="Alto"
                    value={aspectRatio.customHeight}
                    onChange={(e) => setAspectRatio({ ...aspectRatio, customHeight: e.target.value, type: "custom" })}
                    className="w-20"
                    min="1"
                    step="0.1"
                  />
                  {aspectRatio.type === "custom" && calculateCustomAspectRatio() && (
                    <span className="text-sm text-muted-foreground">
                      (≈ {calculateCustomAspectRatio()?.toFixed(2)})
                    </span>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Introduce proporciones personalizadas (ej: 21:9 para ultra panorámico)
              </p>
            </div>
          </div>

          <div className="relative flex-1 bg-muted rounded-lg overflow-hidden" style={{ minHeight: "400px" }}>
            {currentCropIndex !== null && images[currentCropIndex] && (
              <Cropper
                image={images[currentCropIndex].preview}
                crop={cropState.crop}
                zoom={cropState.zoom}
                aspect={getCurrentAspectRatio()}
                onCropChange={(crop) => setCropState((prev) => ({ ...prev, crop }))}
                onZoomChange={(zoom) => setCropState((prev) => ({ ...prev, zoom }))}
                onCropComplete={(_, croppedAreaPixels) => setCropState((prev) => ({ ...prev, croppedAreaPixels }))}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>Zoom: {Math.round(cropState.zoom * 100)}%</Label>
            <Slider
              value={[cropState.zoom]}
              onValueChange={(value) => setCropState((prev) => ({ ...prev, zoom: value[0] }))}
              min={1}
              max={3}
              step={0.1}
              className="w-full"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCropModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={applyCrop}>Aplicar recorte</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
