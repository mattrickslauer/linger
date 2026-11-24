package com.mattricks.verified.devices

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import java.util.UUID

/**
 * Bluetooth LE sensors connected from Settings. Today: the standard Heart Rate profile (0x180D) used by chest
 * straps and by watches that broadcast heart rate, plus Battery (0x180F). One device at a time; it is remembered
 * and reconnected when a Moment starts. While recording, BPM is written into the chain as `hr` events.
 */
@SuppressLint("MissingPermission") // every entry point checks hasPermissions()
object Devices {
    data class Found(val address: String, val name: String, val rssi: Int, val heartRate: Boolean)
    enum class Link { Off, Connecting, Connected }
    data class State(
        val scanning: Boolean = false,
        val found: List<Found> = emptyList(),
        val savedAddress: String? = null,
        val savedName: String? = null,
        val link: Link = Link.Off,
        val bpm: Int? = null,
        val battery: Int? = null,
        val error: String? = null,
    )

    private val HR_SERVICE = uuid16(0x180D)
    private val HR_MEASUREMENT = uuid16(0x2A37)
    private val BATTERY_SERVICE = uuid16(0x180F)
    private val BATTERY_LEVEL = uuid16(0x2A19)
    private val CCCD = uuid16(0x2902)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    private lateinit var app: Context
    private lateinit var sp: SharedPreferences
    private val main = Handler(Looper.getMainLooper())
    private var gatt: BluetoothGatt? = null
    private var wanted = false // user wants a live link → retry on drops

    fun init(ctx: Context) {
        app = ctx.applicationContext
        sp = app.getSharedPreferences("devices", Context.MODE_PRIVATE)
        _state.update { it.copy(savedAddress = sp.getString("address", null), savedName = sp.getString("name", null)) }
    }

    fun permissions(): Array<String> =
        if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)

    fun hasPermissions(): Boolean = permissions().all { ContextCompat.checkSelfPermission(app, it) == PackageManager.PERMISSION_GRANTED }

    private fun adapter() = (app.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    private fun ready(): Boolean {
        val a = adapter()
        val err = when {
            a == null -> "This phone has no Bluetooth"
            !hasPermissions() -> "Bluetooth permission is needed"
            !a.isEnabled -> "Bluetooth is off — turn it on to connect devices"
            else -> null
        }
        _state.update { it.copy(error = err) }
        return err == null
    }

    // ---------- scan ----------

    private val scanCb = object : ScanCallback() {
        override fun onScanResult(type: Int, r: ScanResult) {
            val name = r.scanRecord?.deviceName ?: r.device.name ?: return
            val hr = r.scanRecord?.serviceUuids?.contains(ParcelUuid(HR_SERVICE)) == true
            val f = Found(r.device.address, name, r.rssi, hr)
            _state.update { s ->
                val list = s.found.filterNot { it.address == f.address } + f
                s.copy(found = list.sortedWith(compareByDescending<Found> { it.heartRate }.thenByDescending { it.rssi }))
            }
        }
        override fun onScanFailed(code: Int) { _state.update { it.copy(scanning = false, error = "Scan failed ($code)") } }
    }

    fun startScan() {
        if (!ready() || _state.value.scanning) return
        val scanner = adapter()?.bluetoothLeScanner ?: return
        _state.update { it.copy(scanning = true, found = emptyList()) }
        scanner.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCb)
        main.postDelayed(stopRunnable, 15_000)
    }

    private val stopRunnable = Runnable { stopScan() }

    fun stopScan() {
        main.removeCallbacks(stopRunnable)
        if (!_state.value.scanning) return
        runCatching { if (hasPermissions()) adapter()?.bluetoothLeScanner?.stopScan(scanCb) }
        _state.update { it.copy(scanning = false) }
    }

    // ---------- connect ----------

    fun connect(address: String, name: String) {
        stopScan()
        sp.edit().putString("address", address).putString("name", name).apply()
        _state.update { it.copy(savedAddress = address, savedName = name) }
        wanted = true
        open(address)
    }

    /** Reconnects the remembered device, if any (called when a Moment starts). */
    fun reconnect() {
        val a = _state.value.savedAddress ?: return
        if (_state.value.link != Link.Off) return
        wanted = true
        open(a)
    }

    fun disconnect(forget: Boolean = false) {
        wanted = false
        main.removeCallbacksAndMessages(RETRY)
        runCatching { gatt?.disconnect(); gatt?.close() }
        gatt = null
        _state.update { it.copy(link = Link.Off, bpm = null, battery = null) }
        if (forget) {
            sp.edit().clear().apply()
            _state.update { it.copy(savedAddress = null, savedName = null) }
        }
    }

    private fun open(address: String) {
        if (!ready()) return
        val dev: BluetoothDevice = runCatching { adapter()!!.getRemoteDevice(address) }.getOrNull() ?: return
        runCatching { gatt?.close() }
        _state.update { it.copy(link = Link.Connecting, bpm = null) }
        gatt = dev.connectGatt(app, false, gattCb, BluetoothDevice.TRANSPORT_LE)
    }

    private val RETRY = Any()

    private val gattCb = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                _state.update { it.copy(link = Link.Connected, error = null) }
                g.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                runCatching { g.close() }
                if (gatt == g) gatt = null
                _state.update { it.copy(link = Link.Off, bpm = null) }
                val a = _state.value.savedAddress
                if (wanted && a != null) main.postAtTime({ if (wanted && _state.value.link == Link.Off) open(a) }, RETRY, android.os.SystemClock.uptimeMillis() + 3_000)
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            val hr = g.getService(HR_SERVICE)?.getCharacteristic(HR_MEASUREMENT)
            if (hr == null) {
                _state.update { it.copy(error = "${_state.value.savedName ?: "Device"} doesn't broadcast heart rate") }
                readBattery(g)
                return
            }
            g.setCharacteristicNotification(hr, true)
            val d = hr.getDescriptor(CCCD) ?: return readBattery(g)
            if (Build.VERSION.SDK_INT >= 33) g.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
            else @Suppress("DEPRECATION") { d.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE; g.writeDescriptor(d) }
        }

        // GATT ops are serial: read battery only after the notification subscription is written.
        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) = readBattery(g)

        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) = handle(c, value)

        @Deprecated("API < 33")
        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) { handle(c, c.value ?: return) }

        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray, status: Int) = handle(c, value)

        @Deprecated("API < 33")
        @Suppress("DEPRECATION")
        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) { handle(c, c.value ?: return) }
    }

    private fun readBattery(g: BluetoothGatt) {
        g.getService(BATTERY_SERVICE)?.getCharacteristic(BATTERY_LEVEL)?.let { g.readCharacteristic(it) }
    }

    private fun handle(c: BluetoothGattCharacteristic, v: ByteArray) {
        when (c.uuid) {
            HR_MEASUREMENT -> HeartRate.parse(v)?.let { bpm -> _state.update { it.copy(bpm = bpm) } }
            BATTERY_LEVEL -> v.firstOrNull()?.let { b -> _state.update { it.copy(battery = b.toInt() and 0xff) } }
        }
    }

    private fun uuid16(x: Int): UUID = UUID.fromString(String.format("0000%04x-0000-1000-8000-00805f9b34fb", x))

}
