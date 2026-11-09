package pl.patrykpro.calendar.widgets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Assume;
import org.junit.Before;
import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import javax.xml.parsers.DocumentBuilderFactory;

/**
 * The widgets' resources, read as files: the colours of the fixed looks are
 * those of the resources, every text is there in every language of the app,
 * and the widgets' own layouts carry no text of their own (they would show it
 * in the phone's language, not the app's).
 */
public class WidgetResourcesTest {
    private static final String[] LANGUAGES = {"pl", "de", "es", "fr", "it", "pt-rBR", "uk", "cs", "nl"};

    private File res;

    @Before
    public void resources() {
        res = new File(System.getProperty("user.dir"), "src/main/res");
        Assume.assumeTrue("resources are not part of this checkout", res.isDirectory());
    }

    private static Document xml(File file) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        return factory.newDocumentBuilder().parse(file);
    }

    private Map<String, Integer> colors(String folder) throws Exception {
        Map<String, Integer> out = new HashMap<>();
        NodeList list = xml(new File(res, folder + "/widget_colors.xml")).getElementsByTagName("color");
        for (int i = 0; i < list.getLength(); i++) {
            Element e = (Element) list.item(i);
            String hex = e.getTextContent().trim().substring(1);
            long value = Long.parseLong(hex, 16);
            if (hex.length() == 6) value |= 0xFF000000L;
            out.put(e.getAttribute("name"), (int) value);
        }
        return out;
    }

    @Test
    public void theFixedLooksAreTheResourcesColours() throws Exception {
        Map<String, Integer> light = colors("values");
        assertEquals((Integer) Look.LIGHT_GROUND, light.get("widget_ground"));
        assertEquals((Integer) Look.LIGHT_TEXT, light.get("widget_text"));
        assertEquals((Integer) Look.LIGHT_WEAK, light.get("widget_weak"));
        assertEquals((Integer) Look.LIGHT_DIM, light.get("widget_dim"));
        assertEquals((Integer) Look.LIGHT_DIVIDER, light.get("widget_divider"));
        assertEquals((Integer) Look.LIGHT_ACCENT, light.get("widget_accent"));
        assertEquals((Integer) Look.LIGHT_ON_ACCENT, light.get("widget_on_accent"));
        Map<String, Integer> dark = colors("values-night");
        assertEquals((Integer) Look.DARK_GROUND, dark.get("widget_ground"));
        assertEquals((Integer) Look.DARK_TEXT, dark.get("widget_text"));
        assertEquals((Integer) Look.DARK_WEAK, dark.get("widget_weak"));
        assertEquals((Integer) Look.DARK_DIM, dark.get("widget_dim"));
        assertEquals((Integer) Look.DARK_DIVIDER, dark.get("widget_divider"));
        assertEquals((Integer) Look.DARK_ACCENT, dark.get("widget_accent"));
        assertEquals((Integer) Look.DARK_ON_ACCENT, dark.get("widget_on_accent"));
        assertEquals(light.keySet(), dark.keySet());
    }

    /** The names of the translatable strings and plurals of a widget_strings.xml. */
    private Set<String> texts(String folder) throws Exception {
        Set<String> out = new TreeSet<>();
        Document doc = xml(new File(res, folder + "/widget_strings.xml"));
        for (String tag : new String[] {"string", "plurals"}) {
            NodeList list = doc.getElementsByTagName(tag);
            for (int i = 0; i < list.getLength(); i++) {
                Element e = (Element) list.item(i);
                if (!"false".equals(e.getAttribute("translatable"))) out.add(e.getAttribute("name"));
            }
        }
        return out;
    }

    @Test
    public void everyTextIsInEveryLanguage() throws Exception {
        Set<String> english = texts("values");
        assertTrue(english.contains("widget_no_data"));
        for (String lang : LANGUAGES) {
            assertEquals("values-" + lang, english, texts("values-" + lang));
        }
    }

    @Test
    public void theTranslationsKeepTheirPlaceholders() throws Exception {
        Document en = xml(new File(res, "values/widget_strings.xml"));
        NodeList strings = en.getElementsByTagName("string");
        for (String lang : LANGUAGES) {
            Document doc = xml(new File(res, "values-" + lang + "/widget_strings.xml"));
            NodeList translated = doc.getElementsByTagName("string");
            Map<String, String> byName = new HashMap<>();
            for (int i = 0; i < translated.getLength(); i++) {
                Element e = (Element) translated.item(i);
                byName.put(e.getAttribute("name"), e.getTextContent());
            }
            for (int i = 0; i < strings.getLength(); i++) {
                Element e = (Element) strings.item(i);
                String name = e.getAttribute("name");
                if ("false".equals(e.getAttribute("translatable"))) {
                    assertFalse(lang + " translates " + name, byName.containsKey(name));
                    continue;
                }
                String text = byName.get(name);
                for (String placeholder : new String[] {"%1$s", "%2$s", "%1$d", "%%"}) {
                    assertEquals(lang + " " + name + " " + placeholder, e.getTextContent().contains(placeholder), text.contains(placeholder));
                }
            }
        }
    }

    @Test
    public void theWidgetsLayoutsCarryNoTextOfTheirOwn() throws Exception {
        File[] layouts = new File(res, "layout").listFiles((dir, name) -> name.startsWith("widget_") && !name.startsWith("widget_preview_") && !name.equals("widget_config.xml"));
        assertTrue(layouts != null && layouts.length >= 10);
        for (File layout : layouts) {
            String source = new String(Files.readAllBytes(layout.toPath()), StandardCharsets.UTF_8);
            assertFalse(layout.getName(), source.contains("android:text=") || source.contains("android:contentDescription="));
        }
    }

    @Test
    public void everyWidgetIsDeclaredWithItsSettings() throws Exception {
        for (String kind : new String[] {"agenda", "today", "month", "tasks"}) {
            Element info = xml(new File(res, "xml/widget_" + kind + "_info.xml")).getDocumentElement();
            String ns = "http://schemas.android.com/apk/res/android";
            assertEquals("pl.patrykpro.calendar.widgets.WidgetConfigActivity", info.getAttributeNS(ns, "configure"));
            assertEquals("reconfigurable|configuration_optional", info.getAttributeNS(ns, "widgetFeatures"));
            assertEquals("home_screen", info.getAttributeNS(ns, "widgetCategory"));
            assertEquals("horizontal|vertical", info.getAttributeNS(ns, "resizeMode"));
            assertTrue(new File(res, "layout/widget_preview_" + kind + ".xml").isFile());
            assertTrue(new File(res, "drawable/widget_preview_" + kind + "_image.xml").isFile());
        }
    }
}
