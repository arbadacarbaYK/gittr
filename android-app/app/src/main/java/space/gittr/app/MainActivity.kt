package space.gittr.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var lastSafeAreaJs: String = ""

    private val fileChooser =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val uris =
                if (result.resultCode == Activity.RESULT_OK) {
                    WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
                } else {
                    null
                }
            filePathCallback?.onReceiveValue(uris)
            filePathCallback = null
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webview)
        webView.setBackgroundColor(Color.parseColor("#181b20"))
        WindowInsetsControllerCompat(window, webView).isAppearanceLightStatusBars = false
        WindowInsetsControllerCompat(window, webView).isAppearanceLightNavigationBars = false
        ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
            lastSafeAreaJs = safeAreaJs(insets)
            pushSafeAreaInsets()
            insets
        }
        ViewCompat.requestApplyInsets(webView)

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.javaScriptCanOpenWindowsAutomatically = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.allowFileAccess = false
        settings.allowContentAccess = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.userAgentString = settings.userAgentString + " GittrApp/" + BuildConfig.VERSION_NAME

        webView.webViewClient =
            object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean = handleUri(request.url)

                override fun onPageFinished(
                    view: WebView?,
                    url: String?,
                ) {
                    pushSafeAreaInsets()
                }
            }

        webView.webChromeClient =
            object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView,
                    filePathCallback: ValueCallback<Array<Uri>>,
                    fileChooserParams: FileChooserParams,
                ): Boolean {
                    this@MainActivity.filePathCallback?.onReceiveValue(null)
                    this@MainActivity.filePathCallback = filePathCallback
                    return try {
                        fileChooser.launch(fileChooserParams.createIntent())
                        true
                    } catch (_: Exception) {
                        this@MainActivity.filePathCallback = null
                        false
                    }
                }
            }

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        finish()
                    }
                }
            },
        )

        val deepLink = intent?.data?.toString()?.takeIf { it.startsWith("https://") }
        webView.loadUrl(deepLink ?: START_URL)
    }

    private fun cssPx(px: Int): String {
        val density = resources.displayMetrics.density
        if (density <= 0f) return "0px"
        return (px / density).toString() + "px"
    }

    private fun safeAreaJs(insets: WindowInsetsCompat): String {
        val bars =
            insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
        return """
            (function(){
              var r=document.documentElement;
              if(!r||!r.style) return;
              r.style.setProperty('--gittr-native-safe-top','${cssPx(bars.top)}');
              r.style.setProperty('--gittr-native-safe-bottom','${cssPx(bars.bottom)}');
              r.style.setProperty('--gittr-native-safe-left','${cssPx(bars.left)}');
              r.style.setProperty('--gittr-native-safe-right','${cssPx(bars.right)}');
              r.classList.add('gittr-needs-status-bar-gap');
            })();
            """.trimIndent()
    }

    private fun pushSafeAreaInsets() {
        if (lastSafeAreaJs.isEmpty() || !this::webView.isInitialized) return
        webView.evaluateJavascript(lastSafeAreaJs, null)
    }

    private fun handleUri(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase() ?: return false
        if (scheme == "http" || scheme == "https") {
            val host = uri.host?.lowercase() ?: return true
            if (host == "gittr.space" || host.endsWith(".gittr.space")) {
                return false
            }
            return openExternal(uri)
        }
        if (scheme == "nostrsigner" || scheme == "nostrconnect" || scheme == "bunker" || scheme == "intent") {
            return openExternal(uri)
        }
        return false
    }

    private fun openExternal(uri: Uri): Boolean {
        return try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
            true
        } catch (_: Exception) {
            true
        }
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        super.onPause()
    }

    companion object {
        const val START_URL = "https://gittr.space/?source=apk"
    }
}
