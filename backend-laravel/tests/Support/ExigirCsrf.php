<?php

namespace Tests\Support;

use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;

class ExigirCsrf extends PreventRequestForgery
{
    protected function runningUnitTests(): bool
    {
        return false;
    }
}
