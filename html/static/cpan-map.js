/*
 * Map of CPAN
 * Copyright (c) 2011 Grant McLean <grantm@cpan.org>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

(function($) {

    var opt = {
        app_selector          : 'body',
        app_title             : 'Map of CPAN',
        zoom_minus_label      : 'Zoom map out',
        zoom_plus_label       : 'Zoom map in',
        map_data_url          : 'cpan-map-data.txt',
        ajax_release_url_base : 'http://api.metacpan.org/release/',
        ajax_author_url_base  : 'http://api.metacpan.org/author/',
        ajax_rdeps_search_url : 'http://api.metacpan.org/v0/release/_search?q=%2A&filter=release.dependency.module:%MOD_NAME%&fields=name&size=1000',
        rt_dist_url           : 'https://rt.cpan.org/Public/Dist/Display.html?Name=',
        avatar_url_template   : 'http://www.gravatar.com/avatar/%ID%?s=80&d=%DEFAULT_URL%',
        default_avatar        : 'static/images/no-photo.png',
        zoom_scales           : [ 3, 4, 5, 6, 8, 10, 20 ] // must match CSS
    };

    var cpan = {  // Populated via build_app() call before Sammy.run is called
        meta       : {},
        maint      : [],
        maint_num  : {},
        namespace  : [],
        distro     : [],
        distro_num : {},
        distro_at  : [],
        highlights : []
    };

    var dim;

    var app = $.sammy(opt.app_selector, function() {

        this.use(Sammy.Template, 'tmpl');
        this.use(Sammy.Title);

        var template_cache = {};

        this.helper('loading', function() {
            this.$element().find('.map-info-panel').html('')
                .addClass('loading').removeClass('loaded');
            return this;
        });

        this.helper('update_info', function(selector, data) {
            var context = this;
            var html = context.tmpl(template_cache[selector], data);
            $('.map-info-panel').html(html).removeClass('loading').addClass('loaded');
            return context;
        });

        this.helper('not_implemented', function() {   // TODO: unimplement
            var context = this;
            var html = '<div class="not-impl"><h2>Sorry &#9785;</h2>'
                     + '<p>This feature is not yet implemented.</p></div>';
            $('.map-info-panel').html(html).removeClass('loading');
            return context;
        });

        this.helper('set_highlights', function(highlights) {
            cpan.highlights = highlights;
            this.trigger('show_highlights');
        });

        this.bind('run', function(context, data) {
            var $el = this.$element();
            initialise_ui_elements($el);
            $(window).resize(function() { app.trigger('resize'); });
            $el.find('.zoom-plus').click( function() { app.trigger('increase_zoom'); });
            $el.find('.zoom-minus').click( function() { app.trigger('decrease_zoom'); });
            $el.find('.map-plane-sight').mousewheel( function(e, delta) {
                app.trigger(delta < 0 ? 'decrease_zoom' : 'increase_zoom');
            });
            $('script[type="text/template"]').each(function(i, el) {
                template_cache['#' + el.id] = $(el).html();
            });
        });

        this.bind('ajax_load_failed', function(e) {
            this.$element().find('.map-info-panel')
                .html('Ajax load failed')
                .removeClass('loading');
            return this;
        });

        this.bind('resize', function(e) {
            size_controls( this.$element() );
        });

        this.bind('increase_zoom', function(e) {
            set_zoom(this.$element(), opt.current_zoom + 1);
        });

        this.bind('decrease_zoom', function(e) {
            set_zoom(this.$element(), opt.current_zoom - 1);
        });

        this.bind('separator_moved', function(e) {
            var pos = opt.sep_pos
            var $el = this.$element();
            $el.find('.map-info-panel').width(pos);
            $el.find('.map-panel').css({'padding-left': (pos + 10) + 'px'});
            dim.info_width = pos;
            this.trigger('resize');
        });

        this.bind('distro_hover', function(e, distro) {
            var $el = this.$element();
            $el.find('input.map-hover-distro').val(distro.name);
            var maint = distro.maintainer.id;
            if(distro.maintainer.name) {
                maint = maint + ' - ' + distro.maintainer.name
            }
            $el.find('input.map-hover-maint').val(maint);
        });

        this.bind('distro_select', function(e, distro) {
            this.redirect('#/distro/' + distro.name);
        });

        this.bind('show_highlights', function(e) {
            highlight_distros(this.$element().find('div.map-highlights'));
        });

        this.get('#/', function(context) {
            this.update_info('#tmpl-home', cpan.meta);
            this.set_highlights([]);
            this.title(opt.app_title);
        });

        this.get('#/distro/:name', function(context) {
            var context = this.loading();
            ajax_load_distro_detail( this.params.name, function(distro) {
                context.set_highlights([ distro.index ]);
                context.update_info('#tmpl-distro', distro)
                       .title(distro.name + ' | ' + opt.app_title);
            });
        });

        this.get('#/distro/:name/deps', function(context) {
            var context = this.loading();
            ajax_load_distro_dependencies( this.params.name, function(distro) {
                context.set_highlights(distro.dep_highlights);
                context.update_info('#tmpl-deps', distro)
                       .title('Dependencies | ' + distro.name + ' | ' + opt.app_title);
            });
        });

        this.get('#/distro/:name/rdeps', function(context) {
            return this.not_implemented();
            // It looked like this approach might work - it didn't :-(
            // not sure it's even possible via a jsonp GET request
            var context = this.loading();
            ajax_load_distro_reverse_deps( this.params.name, function(distro) {
                context.set_highlights(distro.rdep_highlights);
                context.update_info('#tmpl-rdeps', distro)
                       .title('Reverse Dependencies | ' + distro.name + ' | ' + opt.app_title);
            });
        });

        this.get('#/module/:name', function(context) {
            return this.not_implemented();
        });

        this.get('#/maint/:cpanid', function(context) {
            var context = this.loading();
            var cpanid  = this.params.cpanid;
            var distros = highlight_distros_for_maint(context, cpanid);
            ajax_load_maint_detail(cpanid, function(maint) {
                var data = {
                    'maint'   : maint,
                    'distros' : distros
                };
                context.update_info('#tmpl-maint', data)
                       .title(maint.name + ' | ' + opt.app_title);
            });
        });


        // Utility functions used by the app

        function initialise_ui_elements($el) {

            $el.find('.map-panel').removeClass('loading');
            $el.find('.map-viewport').html('').append(
                $('<div class="map-plane" />').append(
                    $('<img class="map" src="' + cpan.meta.map_image + '" />'),
                    $('<div class="map-highlights" />'),
                    $('<div class="map-plane-sight" />')
                )
            );

            $el.find('.map-controls').append(
                $('<label>Zoom</label>'),
                $('<ul class="map-zoom" />') .append(
                    $('<li class="zoom-minus"><a>&ndash;</a></li>')
                        .attr('title', opt.zoom_minus_label),
                    $('<li class="zoom-plus"><a>+</a></li>')
                        .attr('title', opt.zoom_plus_label)
                ),
                $('<label>Distro</label>'),
                $('<input class="map-hover-distro" value="" />').width(0),
                $('<label>Maintainer</label>'),
                $('<input class="map-hover-maint" value="" />').width(0)
            );

            size_controls($el);
            set_initial_zoom($el);
            enable_plane_drag($el);
            enable_separator_drag($el);
            attach_hover_handler($el);
        }

        function size_controls($el) {
            var padding = parseInt( $el.css('paddingLeft') );

            var app_height = $(window).height() - padding * 2;
            if(app_height < 300) {
                app_height = 300;
            }
            $el.height(app_height);

            var app_width  = $(window).width() - padding * 2;
            if(app_width < 800) {
                app_width = 800;
            }
            $el.width(app_width);

            var $panel = $el.find('.map-info-panel');
            var panel_height = app_height - parseInt( $panel.css('top') );
            $panel.height( panel_height );
            $el.find('.map-separator').height( panel_height );

            var $controls = $el.find('.map-controls');
            var $input1 = $controls.find('.map-hover-distro');
            var $input2 = $controls.find('.map-hover-maint');
            if(!dim) {
                dim = { info_width: 200 };
                dim.controls_base_width =
                    $input2.offset().left - $controls.offset().left;
            }
            var inp_width = app_width - dim.info_width - 16 - dim.controls_base_width;
            if(inp_width < 250) {
                inp_width = 250;
            }
            $input1.width( Math.floor(inp_width * 3 / 5) );
            $input2.width( Math.floor(inp_width * 2 / 5) );
        }

        function set_initial_zoom($el) {
            var $viewport = $el.find('.map-viewport');
            var width  = $viewport.width();
            var height = $viewport.height();
            var zoom_scales = opt.zoom_scales;
            for(var i = zoom_scales.length - 1; i > 0; i--) {
                if(
                    zoom_scales[i] * cpan.meta.plane_cols < width
                 && zoom_scales[i] * cpan.meta.plane_rows < height
                ) {
                    return set_zoom($el, i);
                }
            }
            return set_zoom($el, 0);
        }

        function set_zoom($el, new_zoom) {
            var zoom_scales = opt.zoom_scales;
            if(new_zoom < 0) {
                new_zoom = 0;
            }
            if(new_zoom >= zoom_scales.length) {
                new_zoom = zoom_scales.length - 1;
            }
            if(new_zoom === opt.current_zoom) {
                return;
            }
            opt.current_zoom = new_zoom;
            opt.scale = zoom_scales[new_zoom];
            var $plane = $el.find('.map-plane');

            for(var z = 1; z < zoom_scales.length; z++) {
                $plane.removeClass('zoom' + z);
            }
            $plane.addClass('zoom' + new_zoom);

            var i = parseInt(new_zoom);
            var width  = opt.scale * cpan.meta.plane_cols;
            var height = opt.scale * cpan.meta.plane_rows;
            $plane.width(width).height(height);
            $plane.find('img.map').width(width).height(height);
            $el.find('.map-plane-sight').css({
                width:  (opt.scale - 2) + 'px',
                height: (opt.scale - 2) + 'px'
            });
            app.trigger('show_highlights');
        }

        function enable_plane_drag($el) {
            var $plane = $el.find('.map-plane');
            $plane.draggable({
                distance: 4,
                start: function(e, ui) {
                    opt.dragging = true;
                },
                stop: function(e, ui) {
                    opt.dragging = false;
                }
            });
        }

        function enable_separator_drag($el) {
            var left_margin = $el.find('.map-panel').offset().left;
            var $sep = $el.find('.map-separator');
            $sep.draggable({
                axis: 'x',
                containment: [left_margin, 0, 500, 0],
                drag: function(e, ui) {
                    var new_pos = ui.offset.left - left_margin;
                    if(opt.sep_pos != new_pos) {
                        opt.sep_pos = new_pos;
                        app.trigger('separator_moved');
                    }
                },
            });
        }

        function attach_hover_handler($el) {
            var $plane = $el.find('.map-plane');
            var cur_row = -1;
            var cur_col = -1;
            var $plane_sight  = $el.find('.map-plane-sight');
            $plane.mousemove(function(e) {
                if(opt.dragging) { return; }
                var offset  = $plane.offset();
                var voffset = $el.find('.map-viewport').offset();
                col = Math.floor((e.pageX - offset.left) / opt.scale);
                row = Math.floor((e.pageY - offset.top) / opt.scale);
                if(row == cur_row && col == cur_col) { return; }
                cur_row = row;
                cur_col = col;
                $plane_sight.css({
                    top:  (cur_row * opt.scale) + 'px',
                    left: (cur_col * opt.scale) + 'px'
                });
                var distro = distro_at_row_col(row, col);
                if(distro) {
                    app.trigger('distro_hover', distro);
                }
            });
            $plane.click(function() {
                if(cur_row < 0 || cur_col < 0) { return; }
                var distro = distro_at_row_col(row, col);
                if(distro) {
                    app.trigger('distro_select', distro);
                }
            });
        }

        function distro_at_row_col(row, col) {
            if(cpan.distro_at[row]) {
                var i = cpan.distro_at[row][col];
                if(i !== null) {
                    return cpan.distro[i];
                }
            }
            return null;
        }

        function ajax_load_distro_detail(distro_name, handler) {
            var i = cpan.distro_num[ distro_name ];
            if(i === null) { return; }
            var distro = cpan.distro[i];
            if(distro == null) { return; }
            var release_name = distro.name.replace(/::/g, '-');
            if(distro.meta) {  //  Data is in cache already
                handler(distro);
                return;
            }
            $.ajax({
                url: opt.ajax_release_url_base + release_name,
                data: { application: 'cpan-map' },
                dataType: 'jsonp',
                success: function(data) {
                    if(!data.resources) {
                        data.resources = { };
                    }
                    if(!data.resources.bugtracker) {
                        data.resources.bugtracker = {
                            web : opt.rt_dist_url + data.distribution
                        };
                    }
                    distro.meta = data;
                    set_avatar_url(distro.maintainer);
                    handler(distro);
                },
                error: function() { app.trigger('ajax_load_failed') },
                timeout: 10000
            });
        }

        function ajax_load_distro_dependencies(distro_name, handler) {
            ajax_load_distro_detail(distro_name, function(distro) {
                if(!distro.deps) {
                    var fdeps = format_dependencies(distro.meta.dependency);
                    distro.deps = fdeps.phased_deps;
                    distro.dep_highlights = fdeps.highlights;
                }
                handler(distro);
            });
        }

        function format_dependencies(dep_list) {
            var by_phase = {};
            var highlights = [];
            for(var i = 0; i < dep_list.length; i++) {
                var dep = dep_list[i];
                phase = dep.phase || 'runtime';
                if(!by_phase[phase]) {
                    by_phase[phase] = [];
                }
                var fdep = format_dep(dep);
                if(fdep.distro) {
                    highlights.push(fdep.index);
                }
                by_phase[phase].push(fdep);
            }
            var phased_deps = [];
            for(var key in by_phase) {
                if(by_phase.hasOwnProperty(key)) {
                    phased_deps.push({ 'name' : key, 'deps' : by_phase[key] });
                }
            }

            return { 'phased_deps' : phased_deps, 'highlights' : highlights };
        }

        function format_dep(dep) {
            var d = {
                'module'  : dep.module,
                'version' : dep.version || 0
            };
            var distro = distro_for_module( dep.module );
            if(distro) {
                d.index = distro.index;
                d.distro = distro.name;
            }
            return d;
        }

        function distro_for_module(module) {
            var i = cpan.distro_num[ module ];
            if(i !== null) {
                return cpan.distro[i];
            }
            return null;
        }

        function ajax_load_distro_reverse_deps(distro_name, handler) {
            var i = cpan.distro_num[ distro_name ];
            if(i === null) { return; }
            var distro = cpan.distro[i];
            if(distro == null) { return; }
            if(distro.rdeps) {  //  Data is in cache already
                handler(distro);
                return;
            }
            var release_name = distro.name.replace(/::/g, '-');
            var search_url = opt.ajax_rdeps_search_url.replace(/%MOD_NAME%/, release_name);
            $.ajax({
                url: search_url,
                data: { application: 'cpan-map' },
                dataType: 'jsonp',
                success: function(data) {
                    format_reverse_dependencies( distro, (data.hits || {}).hits || [] )
                    handler(distro);
                },
                error: function() { app.trigger('ajax_load_failed') },
                timeout: 10000
            });
        }

        function format_reverse_dependencies(distro, hits) {
            distro.rdeps = [];
            distro.rdep_highlights = [];
            var seen = {}
            for(var i = 0; i < hits.length; i++) {
                var name = (hits[i].fields || {}).name;
                if(name) {
                    name = name.replace(/-[^-]+$/, '');
                    name = name.replace(/-/g, '::');
                    if(!seen[name]) {
                        var d = cpan.distro_num[ name ];
                        if(typeof(d) !== 'undefined') {
                            seen[name] = { 'distro' : name, 'index' : d };
                        }
                        else {
                            seen[name] = { 'distro' : name };
                        }
                    }
                }
            }
            for(var key in seen) {
                if(seen.hasOwnProperty(key)) {
                    if(typeof(seen[key].index) !== 'undefined') {
                        distro.rdep_highlights.push(seen[key].index);
                    }
                    distro.rdeps.push( seen[key] );
                }
            }
        }

        function ajax_load_maint_detail(maint_id, handler) {
            var i = cpan.maint_num[ maint_id ];
            if(i === null) { return; }
            var maint = cpan.maint[i];
            if(maint == null) { return; }
            if(maint.meta) {  //  Data is in cache already
                handler(maint);
                return;
            }
            $.ajax({
                url: opt.ajax_author_url_base + maint_id,
                data: { application: 'cpan-map' },
                dataType: 'jsonp',
                success: function(data) {
                    maint.meta = data;
                    if(data.city) {
                        data.location = data.city;
                        if(data.country) {
                            data.location = data.location + ', ' + data.country;
                        }
                    }
                    else {
                        if(data.country) {
                            data.location = data.country;
                        }
                    }
                    delete( maint.avatar_url );
                    set_avatar_url(maint);
                    handler(maint);
                },
                error: function() { app.trigger('ajax_load_failed') },
                timeout: 10000
            });
        }

        function highlight_distros_for_maint(context, cpanid) {
            var highlights = [];
            var distros = [];
            for(var i = 0; i < cpan.distro.length; i++) {
                if(cpan.distro[i].maintainer.id == cpanid) {
                    highlights.push(i);
                    distros.push(cpan.distro[i]);
                }
            }
            context.set_highlights(highlights);
            return distros;
        }

        function set_avatar_url(maintainer) {
            if(maintainer.avatar_url) { return; }
            if(maintainer.meta && maintainer.meta.gravatar_url.match(/\/avatar\/([0-9a-f]+)/)) {
                maintainer.gravatar_id = RegExp.$1;
            }
            if(maintainer.gravatar_id) {
                maintainer.avatar_url = opt.avatar_url_template.replace(/%ID%/, maintainer.gravatar_id);
            }
            else {
                maintainer.avatar_url = opt.default_avatar;
            }
        }

        function highlight_distros($layer) {
            var scale = opt.scale;
            $layer.html('');
            for(var i = 0; i < cpan.highlights.length; i++) {
                var d = cpan.highlights[i];
                var distro = cpan.distro[d];
                $layer.append(
                    $(
                        '<div class="marker" style="top: '
                        + (distro.row * scale) + 'px; left: '
                        + (distro.col * scale) + 'px;" />'
                    )
                );
            }
        }

    });


    // On document ready, Add the required UI elements, download the CPAN
    // metadata and then launch the Sammy application.

    $(function() {

        function build_app($el, run_app) {
            var loc = window.location;
            opt.app_base_url = loc.protocol + '//' + loc.host
                             + loc.pathname.replace(/index[.]html$/, '');
            if(!opt.default_avatar.match(/^\w+:/)) {
                opt.default_avatar = opt.app_base_url + opt.default_avatar;
            }
            opt.avatar_url_template = opt.avatar_url_template.replace(/%DEFAULT_URL%/, escape(opt.default_avatar));

            var $controls = $('<div class="map-controls" />');
            var $viewport = $('<div class="map-viewport" />');
            $el.addClass('cpan-map');
            $el.append(
                $('<h1 />').text( opt.app_title ),
                $('<div class="map-panel loading" />').append(
                    $controls,
                    $('<div class="map-info-panel" />'),
                    $viewport.html('<div class="init">Loading map data</div>'),
                    $('<div class="map-separator" />')
                )
            );
            $.ajax({
                url: opt.map_data_url,
                dataType: 'text',
                success: function (data) {
                    var parser = make_data_parser(data);
                    parse_data(parser);
                    run_app();
                }
            });
        }

        function make_data_parser(data) {
            var i = 0;
            return function() {
                var j = data.indexOf("\n", i);
                if(j < 1) {
                    data = null;
                    return null;
                }
                var line = data.substring(i, j).split(",");
                i = j + 1;
                return line;
            }
        }

        function parse_data(next_record) {
            var rec, handler;

            var add_meta = function(rec) {
                cpan.meta[ rec[0] ] = rec[1];
            };

            var add_maint = function(rec) {
                var m = { id: rec[0] };
                if(rec.length > 1) { m.name        = rec[1]; }
                if(rec.length > 2) { m.gravatar_id = rec[2]; }
                cpan.maint_num[m.id] = cpan.maint.length;
                cpan.maint.push(m);
            };

            var add_ns = function(rec) {
                cpan.namespace.push({
                    name: rec[0],
                    colour: rec[1],
                    mass: parseInt(rec[2], 16)
                });
            };

            var add_distro = function(rec) {
                var row = parseInt(rec[3], 16);
                var col = parseInt(rec[4], 16);
                var distro = {
                    name: rec[0],
                    maintainer: cpan.maint[ parseInt(rec[2], 16) ],
                    row: row,
                    col: col,
                    index: cpan.distro.length
                }
                if(rec[1] != '') {
                    ns = cpan.namespace[ parseInt(rec[1], 16) ];
                    if(ns) {
                        distro.ns = ns.name;
                    }
                }
                if(!cpan.distro_at[row]) {
                    cpan.distro_at[row] = [];
                }
                cpan.distro_at[row][col] = distro.index
                cpan.distro_num[distro.name] = distro.index
                cpan.distro.push( distro );
            };

            while(rec = next_record()) {
                if(rec[0] == '[META]')          { handler = add_meta;   continue; }
                if(rec[0] == '[MAINTAINERS]')   { handler = add_maint;  continue; }
                if(rec[0] == '[NAMESPACES]')    { handler = add_ns;     continue; }
                if(rec[0] == '[DISTRIBUTIONS]') { handler = add_distro; continue; }
                if(handler) {
                    handler(rec);
                }
            }

        }

        build_app(
            $(opt.app_selector),
            function() { app.run('#/'); }
        );

    });

})(jQuery);
