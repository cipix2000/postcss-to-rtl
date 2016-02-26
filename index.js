var postcss = require('postcss');
var path = require("path");
var rtlcss = require("rtlcss");
var propsToConvertRegex = require('./props.js');
var propsToAlwaysConvert = require('./propsToAlwaysConvert.js');

module.exports = postcss.plugin('postcss-inline-rtl', function (opts) {
    opts = opts || {};

    // Check if there is an ignore parameter (full selectors to ignore)
    var ignoreRegex = opts.ignore || null;
    if (!ignoreRegex || ignoreRegex.constructor !== RegExp) {
        ignoreRegex = null;
    }

    var filterRegex = new RegExp(propsToConvertRegex, 'i');
    var propsToAlwaysConvertRegex = new RegExp(propsToAlwaysConvert, 'i');

    return function (css, result) {

        // Save animation names
        var keyFrameNamesToChange = [];
        css.walkAtRules(/keyframes/i, function(atRule) {
            if (keyFrameNamesToChange.indexOf(atRule.params) < 0) {
                keyFrameNamesToChange.push(atRule.params);
            }
        });

        // Generate rtl animation declarations
        css.walkAtRules(/keyframes/i, function(atRule) {
            var newAtRule = atRule.clone();
            newAtRule.params += '-ltr'; // Will be converted to *-rtl
            newAtRule = rtlcss().process(newAtRule).root;
            atRule.parent.insertBefore(atRule, newAtRule);
        });

        /*
         * Go through all "animation" or "animation-name" css declarations
         * If you find an animation name that was converted to rtl above,
         * tell rtlcss to append "-rtl" to the end of the animation name.
         */
        css.walkDecls(/animation$|animation-name/i, function (decl) {
           keyFrameNamesToChange.forEach(function(element, index) {
               var animationNamePosition = decl.value.indexOf(element);
               if (animationNamePosition > -1) {
                   animationNamePosition += element.length;

                   // Check if the name is complete
                   if (!decl.value[animationNamePosition] ||
                        decl.value[animationNamePosition].match(/\,|\ |\;|\!/)) {
                            decl.value = [decl.value.slice(0, animationNamePosition),
                                          "/*rtl:insert:-rtl*/",
                                          decl.value.slice(animationNamePosition)]
                                         .join('');
                   }
               }
           });
        });

        css.walkRules(function (rule) {

            // Do we have any selector that starts with "html"
            if (rule.selectors.some(function (selector) {
                    return selector.indexOf("html") === 0;
                })) {
                return;
            }

            // Filter rules
            if (ignoreRegex && ignoreRegex.test(rule.selector)) {
                return;
            }

            // If we're inside @rule and it's not
            // a media tag, do not parse
            if (rule.parent.type === 'atrule' &&
                !(rule.parent.name.indexOf('media') > -1)) {
                return;
            }

            var rtl = rtlcss().process(rule).root;

            // Go through declarations
            var declarationKeeperLTR = [];
            var declarationKeeperRTL = [];

            for (var declIndex = rule.nodes.length - 1; declIndex >= 0; --declIndex) {
                if (rule.nodes[declIndex].type !== 'decl') {
                    continue;
                }

                var decl = rule.nodes[declIndex];
                var rtlDecl = rtl.nodes[0].nodes[declIndex];

                if (!filterRegex.test(decl.prop)) {
                    continue;
                }

                if (rtlDecl.prop !== decl.prop ||
                    rtlDecl.value !== decl.value ||
                    propsToAlwaysConvertRegex.test(decl.prop)) {

                    declarationKeeperLTR.push(decl);
                    declarationKeeperRTL.push(rtlDecl);
                    decl.remove();
                    rtlDecl.remove();
                }
            }

            if (declarationKeeperLTR.length > 0) {

                var ltrSelectors = rule.selectors.map(function (el) {
                    if (el.indexOf("html") !== 0) {
                        return "html[dir='ltr'] " + el;
                    }

                    return el;
                });

                var rtlSelectors = rule.selectors.map(function (el) {
                    if (el.indexOf("html") !== 0) {
                        return "html[dir='rtl'] " + el;
                    }

                    return el;
                });

                // Create RTL rule
                var newRTLRule = postcss.rule({selectors: rtlSelectors});
                newRTLRule.append(declarationKeeperRTL.reverse());
                rule.parent.insertAfter(rule, newRTLRule);

                // create LTR rule
                var newLTRRule = postcss.rule({selectors: ltrSelectors});
                newLTRRule.append(declarationKeeperLTR.reverse());
                rule.parent.insertAfter(rule, newLTRRule);
            }

            // If we're left with an empty rule
            if (rule.nodes.length === 0) {
                rule.parent.removeChild(rule);
            }
        });

        // Clean up /*rtl:insert:-rtl*/ comments
        css.walkDecls(/animation$|animation-name/i, function (decl) {
            decl.value = decl.value.replace(/\/\*rtl\:insert\:\-rtl\*\//gi, "");
        });
    };
});