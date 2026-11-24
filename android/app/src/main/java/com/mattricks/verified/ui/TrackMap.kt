package com.mattricks.verified.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.RoundedCornerShape
import com.mapbox.geojson.LineString
import com.mapbox.geojson.Point
import com.mapbox.maps.EdgeInsets
import com.mapbox.maps.Style
import com.mapbox.maps.extension.compose.MapboxMap
import com.mapbox.maps.extension.compose.animation.viewport.rememberMapViewportState
import com.mapbox.maps.extension.compose.annotation.generated.CircleAnnotation
import com.mapbox.maps.extension.compose.annotation.generated.PolylineAnnotation
import com.mapbox.maps.extension.compose.style.MapStyle
import com.mapbox.maps.plugin.animation.MapAnimationOptions
import com.mapbox.maps.plugin.viewport.data.OverviewViewportStateOptions
import com.mapbox.maps.dsl.cameraOptions
import com.mattricks.verified.BuildConfig
import com.mattricks.verified.data.LatLng

val mapboxEnabled: Boolean get() = BuildConfig.MAPBOX_TOKEN.isNotBlank()

private val LiveBlue = Color(0xFF2E7DF6)

/**
 * GPS track on a Mapbox Outdoors map. `live` follows the newest fix (recording); otherwise the whole track is fitted
 * (Moment detail). `compact` hides ornaments for the corner mini-map. Falls back to [TrackCanvas] with no token.
 */
@Composable
fun TrackMap(track: List<LatLng>, modifier: Modifier = Modifier, live: Boolean = false, compact: Boolean = false) {
    if (!mapboxEnabled) { TrackCanvas(track, modifier, live); return }
    val pts = track.map { Point.fromLngLat(it.lng, it.lat) }
    val viewport = rememberMapViewportState {
        setCameraOptions { zoom(if (pts.isEmpty()) 1.5 else 16.0); pts.lastOrNull()?.let { center(it) } }
    }
    val last = pts.lastOrNull()
    if (live) {
        LaunchedEffect(last) {
            last ?: return@LaunchedEffect
            viewport.easeTo(cameraOptions { center(last); zoom(16.5) }, MapAnimationOptions.mapAnimationOptions { duration(800) })
        }
    } else {
        LaunchedEffect(pts.size) {
            if (pts.isEmpty()) return@LaunchedEffect
            val geom = if (pts.size == 1) pts[0] else LineString.fromLngLats(pts)
            viewport.transitionToOverviewState(
                OverviewViewportStateOptions.Builder().geometry(geom).padding(EdgeInsets(48.0, 48.0, 48.0, 48.0)).maxZoom(17.0).build(),
            )
        }
    }
    Box(modifier.clip(RoundedCornerShape(12.dp))) {
        MapboxMap(
            Modifier.fillMaxSize(),
            mapViewportState = viewport,
            style = { MapStyle(style = Style.OUTDOORS) },
            compass = { if (!compact) Compass() },
            scaleBar = { if (!compact) ScaleBar() },
            logo = { Logo() },
            attribution = { Attribution() },
        ) {
            if (pts.size > 1) PolylineAnnotation(points = pts) { lineColor = Green; lineWidth = 5.0; lineOpacity = 0.95 }
            pts.firstOrNull()?.let { CircleAnnotation(point = it) { circleRadius = 5.0; circleColor = GreenDark; circleStrokeColor = Color.White; circleStrokeWidth = 2.0 } }
            last?.let {
                if (live) CircleAnnotation(point = it) { circleRadius = 14.0; circleColor = LiveBlue; circleOpacity = 0.2 }
                CircleAnnotation(point = it) { circleRadius = 6.0; circleColor = if (live) LiveBlue else Red; circleStrokeColor = Color.White; circleStrokeWidth = 2.0 }
            }
        }
    }
}
